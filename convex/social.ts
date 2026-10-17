import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { StudioError, requireOwner } from "./lib/owner";

const MAX_LIST = 500;

// ------------------------------------------------------------------ public shapes

/** An account as the web app and the MCP tools see it: never with its credentials. */
function accountView(doc: Doc<"socialAccounts">) {
  const { _id, _creationTime, uid, workspaceUid, credentials, ...rest } = doc; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { id: uid, ...rest };
}

function publicationView(doc: Doc<"publications">) {
  const { _id, _creationTime, uid, workspaceUid, ...rest } = doc; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { id: uid, ...rest };
}

// ------------------------------------------------------------------ lookups

async function mustWorkspace(ctx: QueryCtx, uid: string) {
  const workspace = await ctx.db.query("workspaces").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!workspace) throw new StudioError("workspace_not_found", "Workspace not found");
  return workspace;
}

async function mustAccount(ctx: QueryCtx, workspaceUid: string, uid: string) {
  const account = await ctx.db.query("socialAccounts").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!account || account.workspaceUid !== workspaceUid) throw new StudioError("account_not_found", "Compte introuvable dans ce projet.");
  return account;
}

async function mustPublication(ctx: QueryCtx, workspaceUid: string, uid: string) {
  const publication = await ctx.db.query("publications").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!publication || publication.workspaceUid !== workspaceUid) throw new StudioError("publication_not_found", "Publication introuvable.");
  return publication;
}

// ------------------------------------------------------------------ accounts

export const listAccounts = query({
  args: { workspaceUid: v.string() },
  handler: async (ctx, { workspaceUid }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const rows = await ctx.db.query("socialAccounts").withIndex("by_workspaceUid_and_platform_and_externalId", (q) => q.eq("workspaceUid", workspaceUid)).take(MAX_LIST);
    return rows.map(accountView);
  },
});

/** The only function that returns the stored credentials (still encrypted); called by the server that holds the key. */
export const getAccount = query({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const account = await mustAccount(ctx, workspaceUid, uid);
    return { account: accountView(account), credentials: account.credentials };
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
    await mustWorkspace(ctx, workspaceUid);
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
  args: { workspaceUid: v.string(), uid: v.string(), credentials: v.string(), now: v.string() },
  handler: async (ctx, { workspaceUid, uid, credentials, now }) => {
    await requireOwner(ctx);
    const account = await ctx.db.query("socialAccounts").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
    if (!account || account.workspaceUid !== workspaceUid) return null;
    await ctx.db.patch(account._id, { credentials, status: "active", updatedAt: now });
    return null;
  },
});

export const markNeedsReconnect = mutation({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    const account = await ctx.db.query("socialAccounts").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
    if (!account || account.workspaceUid !== workspaceUid) return null;
    await ctx.db.patch(account._id, { status: "needs_reconnect" });
    return null;
  },
});

export const removeAccount = mutation({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const account = await mustAccount(ctx, workspaceUid, uid);
    await ctx.db.delete(account._id);
    return null;
  },
});

// ------------------------------------------------------------------ publications

const publicationFields = {
  uid: v.string(), workspaceUid: v.string(), generationId: v.string(), fileId: v.string(), accountId: v.string(), platform: v.string(),
  accountName: v.string(), caption: v.string(), options: v.any(), media: v.any(), status: v.string(), state: v.any(),
  remoteId: v.union(v.null(), v.string()), url: v.union(v.null(), v.string()), draft: v.boolean(), error: v.union(v.null(), v.string()),
  scheduledAt: v.optional(v.string()), startedAt: v.union(v.null(), v.string()),
  createdAt: v.string(), updatedAt: v.string(), publishedAt: v.union(v.null(), v.string()),
};

export const listPublications = query({
  args: { workspaceUid: v.string(), generationId: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { workspaceUid, generationId, limit }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const take = Math.max(1, Math.min(Math.floor(limit), MAX_LIST));
    const rows = generationId
      ? await ctx.db.query("publications").withIndex("by_workspaceUid_and_generationId_and_createdAt", (q) => q.eq("workspaceUid", workspaceUid).eq("generationId", generationId)).order("desc").take(take)
      : await ctx.db.query("publications").withIndex("by_workspaceUid_and_createdAt", (q) => q.eq("workspaceUid", workspaceUid)).order("desc").take(take);
    return rows.map(publicationView);
  },
});

export const getPublication = query({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    return publicationView(await mustPublication(ctx, workspaceUid, uid));
  },
});

export const createPublication = mutation({
  args: publicationFields,
  handler: async (ctx, fields) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, fields.workspaceUid);
    const id = await ctx.db.insert("publications", fields);
    return publicationView((await ctx.db.get(id))!);
  },
});

/** Only the fields a publication legitimately changes after creation can be patched. */
export const updatePublication = mutation({
  args: {
    workspaceUid: v.string(), uid: v.string(), updatedAt: v.string(),
    patch: v.object({
      status: v.optional(v.string()), state: v.optional(v.any()), remoteId: v.optional(v.union(v.null(), v.string())),
      url: v.optional(v.union(v.null(), v.string())), draft: v.optional(v.boolean()), error: v.optional(v.union(v.null(), v.string())),
    }),
  },
  handler: async (ctx, { workspaceUid, uid, updatedAt, patch }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const publication = await mustPublication(ctx, workspaceUid, uid);
    const changes: Partial<Doc<"publications">> = { updatedAt };
    for (const key of ["status", "state", "remoteId", "url", "draft", "error"] as const) {
      if (patch[key] !== undefined) (changes as Record<string, unknown>)[key] = patch[key];
    }
    if (patch.status === "published" && !publication.publishedAt) changes.publishedAt = updatedAt;
    await ctx.db.patch(publication._id, changes);
    return publicationView((await ctx.db.get(publication._id))!);
  },
});

export const deletePublication = mutation({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const publication = await mustPublication(ctx, workspaceUid, uid);
    await ctx.db.delete(publication._id);
    return null;
  },
});

/** Moves a due scheduled publication to `processing`; null when someone else already took it. Atomic: transactions are serialized. */
export const claimScheduled = mutation({
  args: { workspaceUid: v.string(), uid: v.string(), nowMs: v.number(), startedAt: v.string(), updatedAt: v.string() },
  handler: async (ctx, { workspaceUid, uid, nowMs, startedAt, updatedAt }) => {
    await requireOwner(ctx);
    const publication = await ctx.db.query("publications").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
    if (!publication || publication.workspaceUid !== workspaceUid || publication.status !== "scheduled") return null;
    if (!publication.scheduledAt || Date.parse(publication.scheduledAt) > nowMs) return null;
    await ctx.db.patch(publication._id, { status: "processing", error: null, startedAt, updatedAt });
    return publicationView((await ctx.db.get(publication._id))!);
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

export const importPublication = mutation({
  args: publicationFields,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (await ctx.db.query("publications").withIndex("by_uid", (q) => q.eq("uid", args.uid)).unique()) return false;
    await ctx.db.insert("publications", args);
    return true;
  },
});
