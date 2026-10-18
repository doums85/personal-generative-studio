"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { requireOwner } from "./lib/owner";
import { translateError } from "../lib/convex/errors.mjs";
import { ConvexSocialStore } from "../lib/convex/social-store.mjs";
import { publishGeneration, stepPublication } from "../lib/social/service.mjs";

/**
 * Publishing runs inside Convex: a scheduled post is sent by a scheduled function at its exact time, and a post
 * still being processed by Instagram or TikTok is followed by a chain of scheduled checks. The code that talks to
 * the networks is the same as in the web app (lib/social); only the database access differs.
 */

const FIRST_CHECK_MS = 4_000;
/** A scheduled post this late means its scheduled function was lost. */
const DUE_GRACE_MS = 90_000;
/** A processing post nobody has touched for this long has lost its chain of checks. */
const STALE_MS = 3 * 60_000;
/** A start that never reported back this long ago cannot be retried safely. */
const INTERRUPTED_MS = 10 * 60_000;

/** The social store the shared publishing code expects, backed by internal Convex functions. */
function socialFor(ctx: ActionCtx) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guard = async <T>(call: Promise<T>): Promise<T> => { try { return await call; } catch (error) { throw translateError(error); } };
  const studio = {
    backend: "convex",
    now: () => new Date(),
    idFactory: () => crypto.randomUUID(),
    // One action drives one publication, so there is nothing to exclude here.
    withLock: <T>(_key: string, work: () => Promise<T>) => work(),
    getGeneration: (workspaceUid: string, uid: string) => guard(ctx.runQuery(internal.libraryInternal.getGeneration, { workspaceUid, uid })),
    service: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (reference: any, args: any) => guard(ctx.runQuery(reference, args)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mutation: (reference: any, args: any) => guard(ctx.runMutation(reference, args)),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ConvexSocialStore(studio, { env: process.env, functions: internal.socialInternal as any }); // the JS store only needs the function references by name
}

/** Errors the web app should see with their message and status must be ConvexErrors: anything else reaches the client as "Server Error". */
function forClient(error: unknown): unknown {
  const e = error as { name?: string; status?: number; code?: string; message?: string; details?: unknown };
  if (error instanceof ConvexError) return error;
  if (e?.name === "ZodError") return new ConvexError({ kind: "studio", code: "invalid_request", message: "Invalid request", status: 400 });
  if (e?.code && Number.isInteger(e.status)) return new ConvexError({ kind: e.name === "SocialError" ? "social" : "studio", code: e.code, message: e.message ?? "Error", status: e.status, details: JSON.parse(JSON.stringify(e.details ?? null)) });
  return error;
}

type StuckRow = { workspaceUid: string; uid: string; hasState: boolean; startedAt: string | null };

function nextCheckDelay(publication: { startedAt?: string | null; createdAt: string }, nowMs: number) {
  const elapsed = nowMs - Date.parse(publication.startedAt || publication.createdAt);
  if (elapsed < 60_000) return 5_000;
  if (elapsed < 5 * 60_000) return 15_000;
  return 60_000;
}

/**
 * Publishes now or schedules, for the web app and the MCP server. Immediate posts are sent before this returns
 * (Instagram and TikTok may still be processing); scheduled ones are queued for their time by the mutation that stores them.
 */
export const publish = action({
  args: { workspaceUid: v.string(), input: v.any() },
  handler: async (ctx, { workspaceUid, input }) => {
    await requireOwner(ctx);
    try {
      const publications = await publishGeneration({ social: socialFor(ctx), workspaceId: workspaceUid, input, env: process.env });
      for (const publication of publications) {
        if (publication.status === "processing") await ctx.scheduler.runAfter(FIRST_CHECK_MS, internal.publishing.runPublication, { workspaceUid, uid: publication.id, mode: "advance" });
      }
      return publications;
    } catch (error) {
      throw forClient(error);
    }
  },
});

/** One step of a publication: `start` sends a scheduled post when its time comes, `advance` checks on one the network is processing. */
export const runPublication = internalAction({
  args: { workspaceUid: v.string(), uid: v.string(), mode: v.union(v.literal("start"), v.literal("advance")) },
  handler: async (ctx, { workspaceUid, uid, mode }) => {
    const social = socialFor(ctx);
    let publication;
    try {
      publication = await social.getPublication(workspaceUid, uid);
    } catch {
      return null; // cancelled, or its project was deleted
    }
    if (mode === "start") {
      // Atomic: if the post was cancelled or already taken, nothing is sent.
      publication = await social.claimScheduled(workspaceUid, uid, Date.now());
      if (!publication) return null;
    } else if (publication.status !== "processing") {
      return null;
    }
    const result = await stepPublication({ social, workspaceId: workspaceUid, publication, mode, env: process.env });
    if (result.status === "processing") {
      await ctx.scheduler.runAfter(nextCheckDelay(result, Date.now()), internal.publishing.runPublication, { workspaceUid, uid, mode: "advance" });
    }
    return null;
  },
});

/** Safety net, run by a cron: restarts what lost its scheduled function and gives up on what can no longer be followed. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ due: number; stalled: number }> => {
    const now = Date.now();
    const { due, stalled }: { due: StuckRow[]; stalled: StuckRow[] } = await ctx.runQuery(internal.socialInternal.listStuck, {
      dueBefore: new Date(now - DUE_GRACE_MS).toISOString(),
      staleBefore: new Date(now - STALE_MS).toISOString(),
    });
    for (const row of due) {
      await ctx.scheduler.runAfter(0, internal.publishing.runPublication, { workspaceUid: row.workspaceUid, uid: row.uid, mode: "start" });
    }
    for (const row of stalled) {
      if (row.hasState) {
        await ctx.scheduler.runAfter(0, internal.publishing.runPublication, { workspaceUid: row.workspaceUid, uid: row.uid, mode: "advance" });
      } else if (row.startedAt && now - Date.parse(row.startedAt) > INTERRUPTED_MS) {
        await ctx.runMutation(internal.socialInternal.failInterrupted, { workspaceUid: row.workspaceUid, uid: row.uid, updatedAt: new Date(now).toISOString() });
      }
    }
    return { due: due.length, stalled: stalled.length };
  },
});
