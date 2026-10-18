import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./lib/owner";
import * as db from "./lib/socialDb";
import { accountView, publicationView } from "./lib/views";

const MAX_LIST = 500;

// ------------------------------------------------------------------ accounts

export const listAccounts = query({
  args: { workspaceUid: v.string() },
  handler: async (ctx, { workspaceUid }) => {
    await requireOwner(ctx);
    await db.mustWorkspace(ctx, workspaceUid);
    const rows = await ctx.db.query("socialAccounts").withIndex("by_workspaceUid_and_platform_and_externalId", (q) => q.eq("workspaceUid", workspaceUid)).take(MAX_LIST);
    return rows.map(accountView);
  },
});

export const getAccount = query({
  args: db.accountRef,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.getAccount(ctx, args);
  },
});

/** Adds the accounts a connector returned, or refreshes the ones already known (same network and external id). */
export const upsertAccounts = mutation({
  args: {
    workspaceUid: v.string(),
    now: v.string(),
    accounts: v.array(v.object({
      uid: v.string(), platform: v.string(), externalId: v.string(), name: v.string(),
      handle: v.union(v.null(), v.string()), avatarUrl: v.union(v.null(), v.string()), credentials: v.string(),
    })),
  },
  handler: async (ctx, { workspaceUid, now, accounts }) => {
    await requireOwner(ctx);
    await db.mustWorkspace(ctx, workspaceUid);
    const saved: Doc<"socialAccounts">[] = [];
    for (const draft of accounts) {
      const existing = await ctx.db.query("socialAccounts")
        .withIndex("by_workspaceUid_and_platform_and_externalId", (q) => q.eq("workspaceUid", workspaceUid).eq("platform", draft.platform).eq("externalId", draft.externalId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { name: draft.name, handle: draft.handle, avatarUrl: draft.avatarUrl, credentials: draft.credentials, status: "active", updatedAt: now });
        saved.push((await ctx.db.get(existing._id))!);
      } else {
        const id = await ctx.db.insert("socialAccounts", { ...draft, workspaceUid, status: "active", connectedAt: now, updatedAt: now });
        saved.push((await ctx.db.get(id))!);
      }
    }
    return saved.map(accountView);
  },
});

export const updateCredentials = mutation({
  args: db.credentialsArgs,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.updateCredentials(ctx, args);
  },
});

export const markNeedsReconnect = mutation({
  args: db.accountRef,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.markNeedsReconnect(ctx, args);
  },
});

export const removeAccount = mutation({
  args: db.accountRef,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.removeAccount(ctx, args);
  },
});

// ------------------------------------------------------------------ publications

export const listPublications = query({
  args: { workspaceUid: v.string(), generationId: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { workspaceUid, generationId, limit }) => {
    await requireOwner(ctx);
    await db.mustWorkspace(ctx, workspaceUid);
    const take = Math.max(1, Math.min(Math.floor(limit), MAX_LIST));
    const rows = generationId
      ? await ctx.db.query("publications").withIndex("by_workspaceUid_and_generationId_and_createdAt", (q) => q.eq("workspaceUid", workspaceUid).eq("generationId", generationId)).order("desc").take(take)
      : await ctx.db.query("publications").withIndex("by_workspaceUid_and_createdAt", (q) => q.eq("workspaceUid", workspaceUid)).order("desc").take(take);
    return rows.map(publicationView);
  },
});

export const getPublication = query({
  args: db.publicationRef,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.getPublication(ctx, args);
  },
});

export const createPublication = mutation({
  args: db.publicationFields,
  handler: async (ctx, fields) => {
    await requireOwner(ctx);
    return db.createPublication(ctx, fields);
  },
});

export const updatePublication = mutation({
  args: db.updatePublicationArgs,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.updatePublication(ctx, args);
  },
});

export const deletePublication = mutation({
  args: db.publicationRef,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.deletePublication(ctx, args);
  },
});

export const claimScheduled = mutation({
  args: db.claimArgs,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return db.claimScheduled(ctx, args);
  },
});

// ------------------------------------------------------------------ import from the former JSON files

export const importAccount = mutation({
  args: {
    uid: v.string(), workspaceUid: v.string(), platform: v.string(), externalId: v.string(), name: v.string(),
    handle: v.union(v.null(), v.string()), avatarUrl: v.union(v.null(), v.string()), status: v.string(), credentials: v.string(),
    connectedAt: v.string(), updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (await ctx.db.query("socialAccounts").withIndex("by_uid", (q) => q.eq("uid", args.uid)).unique()) return false;
    await ctx.db.insert("socialAccounts", args);
    return true;
  },
});

/** A scheduled publication keeps its time: it is queued again here (a past time runs at once). */
export const importPublication = mutation({
  args: db.publicationFields,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (await ctx.db.query("publications").withIndex("by_uid", (q) => q.eq("uid", args.uid)).unique()) return false;
    await db.createPublication(ctx, args);
    return true;
  },
});
