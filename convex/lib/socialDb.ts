import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { StudioError } from "./owner";
import { accountView, publicationView } from "./views";

/**
 * The database side of publishing. Both the owner-checked public functions (called by the web app and the MCP
 * server) and the internal ones (called by the publishing actions, which run without a user) share these handlers.
 */

export async function mustWorkspace(ctx: QueryCtx, uid: string) {
  const workspace = await ctx.db.query("workspaces").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!workspace) throw new StudioError("workspace_not_found", "Workspace not found");
  return workspace;
}

export async function mustAccount(ctx: QueryCtx, workspaceUid: string, uid: string) {
  const account = await ctx.db.query("socialAccounts").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!account || account.workspaceUid !== workspaceUid) throw new StudioError("account_not_found", "Compte introuvable dans ce projet.");
  return account;
}

async function mustPublication(ctx: QueryCtx, workspaceUid: string, uid: string) {
  const publication = await ctx.db.query("publications").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!publication || publication.workspaceUid !== workspaceUid) throw new StudioError("publication_not_found", "Publication introuvable.");
  return publication;
}

// ------------------------------------------------------------------ validators

export const publicationFields = {
  uid: v.string(), workspaceUid: v.string(), generationId: v.string(), fileId: v.string(), accountId: v.string(), platform: v.string(),
  accountName: v.string(), caption: v.string(), options: v.any(), media: v.any(), status: v.string(), state: v.any(),
  remoteId: v.union(v.null(), v.string()), url: v.union(v.null(), v.string()), draft: v.boolean(), error: v.union(v.null(), v.string()),
  scheduledAt: v.optional(v.string()), startedAt: v.union(v.null(), v.string()),
  createdAt: v.string(), updatedAt: v.string(), publishedAt: v.union(v.null(), v.string()),
};
export const accountRef = { workspaceUid: v.string(), uid: v.string() };
export const credentialsArgs = { workspaceUid: v.string(), uid: v.string(), credentials: v.string(), now: v.string() };
export const publicationRef = { workspaceUid: v.string(), uid: v.string() };
export const updatePublicationArgs = {
  workspaceUid: v.string(), uid: v.string(), updatedAt: v.string(),
  patch: v.object({
    status: v.optional(v.string()), state: v.optional(v.any()), remoteId: v.optional(v.union(v.null(), v.string())),
    url: v.optional(v.union(v.null(), v.string())), draft: v.optional(v.boolean()), error: v.optional(v.union(v.null(), v.string())),
  }),
};
export const claimArgs = { workspaceUid: v.string(), uid: v.string(), nowMs: v.number(), startedAt: v.string(), updatedAt: v.string() };

// ------------------------------------------------------------------ accounts

/** The only handler that returns the stored credentials (still encrypted); called by the server that holds the key. */
export async function getAccount(ctx: QueryCtx, { workspaceUid, uid }: { workspaceUid: string; uid: string }) {
  await mustWorkspace(ctx, workspaceUid);
  const account = await mustAccount(ctx, workspaceUid, uid);
  return { account: accountView(account), credentials: account.credentials };
}

export async function updateCredentials(ctx: MutationCtx, { workspaceUid, uid, credentials, now }: { workspaceUid: string; uid: string; credentials: string; now: string }) {
  const account = await ctx.db.query("socialAccounts").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!account || account.workspaceUid !== workspaceUid) return null;
  await ctx.db.patch(account._id, { credentials, status: "active", updatedAt: now });
  return null;
}

export async function markNeedsReconnect(ctx: MutationCtx, { workspaceUid, uid }: { workspaceUid: string; uid: string }) {
  const account = await ctx.db.query("socialAccounts").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!account || account.workspaceUid !== workspaceUid) return null;
  await ctx.db.patch(account._id, { status: "needs_reconnect" });
  return null;
}

// ------------------------------------------------------------------ publications

export async function getPublication(ctx: QueryCtx, { workspaceUid, uid }: { workspaceUid: string; uid: string }) {
  await mustWorkspace(ctx, workspaceUid);
  return publicationView(await mustPublication(ctx, workspaceUid, uid));
}

/** Stores a publication; a scheduled one is also queued for its exact time, in the same transaction. */
export async function createPublication(ctx: MutationCtx, fields: Omit<Doc<"publications">, "_id" | "_creationTime" | "scheduledFunctionId">) {
  await mustWorkspace(ctx, fields.workspaceUid);
  const id = await ctx.db.insert("publications", fields);
  if (fields.status === "scheduled" && fields.scheduledAt) {
    const scheduledFunctionId = await ctx.scheduler.runAt(Date.parse(fields.scheduledAt), internal.publishing.runPublication, { workspaceUid: fields.workspaceUid, uid: fields.uid, mode: "start" });
    await ctx.db.patch(id, { scheduledFunctionId });
  }
  return publicationView((await ctx.db.get(id))!);
}

/** Only the fields a publication legitimately changes after creation can be patched. */
export async function updatePublication(ctx: MutationCtx, { workspaceUid, uid, updatedAt, patch }: { workspaceUid: string; uid: string; updatedAt: string; patch: Record<string, unknown> }) {
  await mustWorkspace(ctx, workspaceUid);
  const publication = await mustPublication(ctx, workspaceUid, uid);
  const changes: Record<string, unknown> = { updatedAt };
  for (const key of ["status", "state", "remoteId", "url", "draft", "error"]) {
    if (patch[key] !== undefined) changes[key] = patch[key];
  }
  if (patch.status === "published" && !publication.publishedAt) changes.publishedAt = updatedAt;
  await ctx.db.patch(publication._id, changes);
  return publicationView((await ctx.db.get(publication._id))!);
}

/** Moves a due scheduled publication to `processing`; null when someone else already took it. Atomic: transactions are serialized. */
export async function claimScheduled(ctx: MutationCtx, { workspaceUid, uid, nowMs, startedAt, updatedAt }: { workspaceUid: string; uid: string; nowMs: number; startedAt: string; updatedAt: string }) {
  const publication = await ctx.db.query("publications").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!publication || publication.workspaceUid !== workspaceUid || publication.status !== "scheduled") return null;
  if (!publication.scheduledAt || Date.parse(publication.scheduledAt) > nowMs) return null;
  await ctx.db.patch(publication._id, { status: "processing", error: null, startedAt, updatedAt });
  return publicationView((await ctx.db.get(publication._id))!);
}

/** Cancels the queued send of a scheduled publication, if there is one. */
export async function cancelSchedule(ctx: MutationCtx, publication: Doc<"publications">) {
  if (publication.status !== "scheduled" || !publication.scheduledFunctionId) return;
  try {
    await ctx.scheduler.cancel(publication.scheduledFunctionId);
  } catch {
    // Already started or finished: the claim makes a late run harmless.
  }
}

export async function deletePublication(ctx: MutationCtx, { workspaceUid, uid }: { workspaceUid: string; uid: string }) {
  await mustWorkspace(ctx, workspaceUid);
  const publication = await mustPublication(ctx, workspaceUid, uid);
  await cancelSchedule(ctx, publication);
  await ctx.db.delete(publication._id);
  return null;
}

/** What the watchdog should look at: scheduled posts that missed their time and processing posts nobody has touched for a while. */
export async function listStuck(ctx: QueryCtx, { dueBefore, staleBefore }: { dueBefore: string; staleBefore: string }) {
  const due = await ctx.db.query("publications").withIndex("by_status_and_scheduledAt", (q) => q.eq("status", "scheduled").lte("scheduledAt", dueBefore)).take(50);
  const stalled = await ctx.db.query("publications").withIndex("by_status_and_updatedAt", (q) => q.eq("status", "processing").lte("updatedAt", staleBefore)).take(50);
  const pick = (row: Doc<"publications">) => ({ workspaceUid: row.workspaceUid, uid: row.uid, hasState: row.state !== null && row.state !== undefined, startedAt: row.startedAt });
  return { due: due.map(pick), stalled: stalled.map(pick) };
}

/** A post whose start never reported back cannot be retried safely (it might already be live): say so instead of waiting forever. */
export async function failInterrupted(ctx: MutationCtx, { workspaceUid, uid, updatedAt }: { workspaceUid: string; uid: string; updatedAt: string }) {
  const publication = await ctx.db.query("publications").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!publication || publication.workspaceUid !== workspaceUid || publication.status !== "processing" || publication.state) return null;
  await ctx.db.patch(publication._id, { status: "failed", state: null, updatedAt, error: "La publication a été interrompue avant la réponse du réseau : vérifiez sur le réseau avant de la relancer." });
  return null;
}

export async function removeAccount(ctx: MutationCtx, { workspaceUid, uid }: { workspaceUid: string; uid: string }) {
  await mustWorkspace(ctx, workspaceUid);
  const account = await mustAccount(ctx, workspaceUid, uid);
  await ctx.db.delete(account._id);
  return null;
}
