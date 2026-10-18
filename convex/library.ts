import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { StudioError, requireOwner } from "./lib/owner";
import { cancelSchedule } from "./lib/socialDb";
import { elementView, generationView, summaryView, workspaceView } from "./lib/views";

/** Most rows any listing returns; keeps every query inside Convex's read limits. */
const MAX_LIST = 500;
/** Rows deleted per step when a workspace is purged. */
const PURGE_BATCH = 100;

const imageRef = v.object({
  id: v.string(),
  file: v.string(),
  mediaType: v.string(),
  bytes: v.number(),
  source: v.optional(v.string()),
  createdAt: v.string(),
});
const fileRef = v.object({ id: v.string(), file: v.string(), mediaType: v.string(), bytes: v.number(), role: v.string() });
const modelRef = v.union(v.null(), v.object({ id: v.string(), name: v.optional(v.string()), provider: v.optional(v.string()) }));

// ------------------------------------------------------------------ lookups

async function findWorkspace(ctx: QueryCtx, uid: string) {
  return ctx.db.query("workspaces").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
}

async function mustWorkspace(ctx: QueryCtx, uid: string) {
  const workspace = await findWorkspace(ctx, uid);
  if (!workspace) throw new StudioError("workspace_not_found", "Workspace not found");
  return workspace;
}

async function mustElement(ctx: QueryCtx, workspaceUid: string, uid: string) {
  const element = await ctx.db.query("elements").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!element || element.workspaceUid !== workspaceUid) throw new StudioError("element_not_found", "Element not found");
  return element;
}

async function mustGeneration(ctx: QueryCtx, workspaceUid: string, uid: string) {
  const generation = await ctx.db.query("generations").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
  if (!generation || generation.workspaceUid !== workspaceUid) throw new StudioError("generation_not_found", "Generation not found");
  return generation;
}

async function touch(ctx: MutationCtx, workspace: Doc<"workspaces">, updatedAt: string, changes: Partial<Doc<"workspaces">> = {}) {
  await ctx.db.patch(workspace._id, { ...changes, updatedAt });
}

const amountOf = (estimate: unknown) => {
  const amount = (estimate as { amount?: unknown } | null)?.amount;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
};

// ------------------------------------------------------------------ workspaces

export const listWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const rows = await ctx.db.query("workspaces").withIndex("by_updatedAt").order("desc").take(MAX_LIST);
    return rows.map(workspaceView);
  },
});

export const getWorkspace = query({
  args: { uid: v.string() },
  handler: async (ctx, { uid }) => {
    await requireOwner(ctx);
    return workspaceView(await mustWorkspace(ctx, uid));
  },
});

/** The workspace with its counters, for the dashboard and the project switcher. */
export const workspaceSummary = query({
  args: { uid: v.string() },
  handler: async (ctx, { uid }) => {
    await requireOwner(ctx);
    return summaryView(await mustWorkspace(ctx, uid));
  },
});

export const createWorkspace = mutation({
  args: { uid: v.string(), name: v.string(), description: v.string(), settings: v.any(), createdAt: v.string() },
  handler: async (ctx, { createdAt, ...fields }) => {
    await requireOwner(ctx);
    const id = await ctx.db.insert("workspaces", { ...fields, counts: { elements: 0, generations: 0, images: 0, videos: 0 }, spentUsd: 0, createdAt, updatedAt: createdAt });
    return workspaceView((await ctx.db.get(id))!);
  },
});

export const updateWorkspace = mutation({
  args: {
    uid: v.string(),
    patch: v.object({ name: v.optional(v.string()), description: v.optional(v.string()), settings: v.optional(v.any()) }),
    updatedAt: v.string(),
  },
  handler: async (ctx, { uid, patch, updatedAt }) => {
    await requireOwner(ctx);
    const workspace = await mustWorkspace(ctx, uid);
    const changes: Partial<Doc<"workspaces">> = {};
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.description !== undefined) changes.description = patch.description;
    // Settings merge key by key, like a PATCH of the project's art direction.
    if (patch.settings !== undefined) changes.settings = { ...workspace.settings, ...patch.settings };
    await touch(ctx, workspace, updatedAt, changes);
    return workspaceView((await ctx.db.get(workspace._id))!);
  },
});

/** Removes the workspace at once; its elements, generations, files and social data are purged in the background. */
export const deleteWorkspace = mutation({
  args: { uid: v.string() },
  handler: async (ctx, { uid }) => {
    await requireOwner(ctx);
    const workspace = await mustWorkspace(ctx, uid);
    await ctx.db.delete(workspace._id);
    await ctx.scheduler.runAfter(0, internal.library.purgeWorkspace, { uid });
    return null;
  },
});

export const purgeWorkspace = internalMutation({
  args: { uid: v.string() },
  handler: async (ctx, { uid }) => {
    let more = false;
    const elements = await ctx.db.query("elements").withIndex("by_workspaceUid_and_updatedAt", (q) => q.eq("workspaceUid", uid)).take(PURGE_BATCH);
    for (const row of elements) await ctx.db.delete(row._id);
    const generations = await ctx.db.query("generations").withIndex("by_workspaceUid_and_createdAt", (q) => q.eq("workspaceUid", uid)).take(PURGE_BATCH);
    for (const row of generations) await ctx.db.delete(row._id);
    const files = await ctx.db.query("media").withIndex("by_workspaceUid_and_file", (q) => q.eq("workspaceUid", uid)).take(PURGE_BATCH);
    for (const row of files) {
      await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
    }
    const accounts = await ctx.db.query("socialAccounts").withIndex("by_workspaceUid_and_platform_and_externalId", (q) => q.eq("workspaceUid", uid)).take(PURGE_BATCH);
    for (const row of accounts) await ctx.db.delete(row._id);
    const publications = await ctx.db.query("publications").withIndex("by_workspaceUid_and_createdAt", (q) => q.eq("workspaceUid", uid)).take(PURGE_BATCH);
    for (const row of publications) {
      await cancelSchedule(ctx, row);
      await ctx.db.delete(row._id);
    }
    more = [elements, generations, files, accounts, publications].some((rows) => rows.length === PURGE_BATCH);
    if (more) await ctx.scheduler.runAfter(0, internal.library.purgeWorkspace, { uid });
    return null;
  },
});

// ------------------------------------------------------------------ media files

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const registerMedia = mutation({
  args: { workspaceUid: v.string(), file: v.string(), storageId: v.id("_storage"), mediaType: v.string(), bytes: v.number(), createdAt: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, args.workspaceUid);
    await ctx.db.insert("media", args);
    return null;
  },
});

export const getMediaUrl = query({
  args: { workspaceUid: v.string(), file: v.string() },
  handler: async (ctx, { workspaceUid, file }) => {
    await requireOwner(ctx);
    const row = await ctx.db.query("media").withIndex("by_workspaceUid_and_file", (q) => q.eq("workspaceUid", workspaceUid).eq("file", file)).unique();
    if (!row) return null;
    const url = await ctx.storage.getUrl(row.storageId);
    return url ? { url, mediaType: row.mediaType, bytes: row.bytes } : null;
  },
});

async function deleteMediaRow(ctx: MutationCtx, workspaceUid: string, file: string) {
  const row = await ctx.db.query("media").withIndex("by_workspaceUid_and_file", (q) => q.eq("workspaceUid", workspaceUid).eq("file", file)).unique();
  if (!row) return;
  await ctx.storage.delete(row.storageId);
  await ctx.db.delete(row._id);
}

export const removeMedia = mutation({
  args: { workspaceUid: v.string(), file: v.string() },
  handler: async (ctx, { workspaceUid, file }) => {
    await requireOwner(ctx);
    await deleteMediaRow(ctx, workspaceUid, file);
    return null;
  },
});

// ------------------------------------------------------------------ elements

export const listElements = query({
  args: { workspaceUid: v.string(), kind: v.optional(v.string()) },
  handler: async (ctx, { workspaceUid, kind }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const rows = await ctx.db.query("elements").withIndex("by_workspaceUid_and_updatedAt", (q) => q.eq("workspaceUid", workspaceUid)).order("desc").take(MAX_LIST);
    return rows.filter((row) => !kind || row.kind === kind).map(elementView);
  },
});

export const getElement = query({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    return elementView(await mustElement(ctx, workspaceUid, uid));
  },
});

export const createElement = mutation({
  args: {
    workspaceUid: v.string(), uid: v.string(), kind: v.string(), name: v.string(), description: v.string(),
    tags: v.array(v.string()), voice: v.optional(v.any()), images: v.array(imageRef), createdAt: v.string(),
  },
  handler: async (ctx, { createdAt, ...fields }) => {
    await requireOwner(ctx);
    const workspace = await mustWorkspace(ctx, fields.workspaceUid);
    const id = await ctx.db.insert("elements", { ...fields, createdAt, updatedAt: createdAt });
    await touch(ctx, workspace, createdAt, { counts: { ...workspace.counts, elements: workspace.counts.elements + 1 } });
    return elementView((await ctx.db.get(id))!);
  },
});

/** Applies a patch and image changes in one transaction; returns the files nobody references any more. */
export const updateElement = mutation({
  args: {
    workspaceUid: v.string(), uid: v.string(),
    patch: v.object({ kind: v.optional(v.string()), name: v.optional(v.string()), description: v.optional(v.string()), tags: v.optional(v.array(v.string())), voice: v.optional(v.any()) }),
    addImages: v.array(imageRef), removeImageIds: v.array(v.string()), primaryImageId: v.optional(v.string()), updatedAt: v.string(),
  },
  handler: async (ctx, { workspaceUid, uid, patch, addImages, removeImageIds, primaryImageId, updatedAt }) => {
    await requireOwner(ctx);
    const workspace = await mustWorkspace(ctx, workspaceUid);
    const element = await mustElement(ctx, workspaceUid, uid);
    const removed = element.images.filter((image) => removeImageIds.includes(image.id));
    const images = [...element.images.filter((image) => !removeImageIds.includes(image.id)), ...addImages];
    if (primaryImageId) {
      const index = images.findIndex((image) => image.id === primaryImageId);
      if (index > 0) images.unshift(...images.splice(index, 1));
    }
    const changes: Partial<Doc<"elements">> = { images, updatedAt };
    if (patch.kind !== undefined) changes.kind = patch.kind;
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.description !== undefined) changes.description = patch.description;
    if (patch.tags !== undefined) changes.tags = patch.tags;
    if (patch.voice !== undefined) changes.voice = { ...(element.voice || {}), ...patch.voice };
    await ctx.db.patch(element._id, changes);
    await touch(ctx, workspace, updatedAt);
    return { element: elementView((await ctx.db.get(element._id))!), removedFiles: removed.map((image) => image.file) };
  },
});

export const deleteElement = mutation({
  args: { workspaceUid: v.string(), uid: v.string(), updatedAt: v.string() },
  handler: async (ctx, { workspaceUid, uid, updatedAt }) => {
    await requireOwner(ctx);
    const workspace = await mustWorkspace(ctx, workspaceUid);
    const element = await mustElement(ctx, workspaceUid, uid);
    await ctx.db.delete(element._id);
    await touch(ctx, workspace, updatedAt, { counts: { ...workspace.counts, elements: Math.max(0, workspace.counts.elements - 1) } });
    return element.images.map((image) => image.file);
  },
});

// ------------------------------------------------------------------ generations

export const listGenerations = query({
  args: { workspaceUid: v.string(), kind: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { workspaceUid, kind, limit }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const take = Math.max(1, Math.min(Math.floor(limit), MAX_LIST));
    const rows = kind
      ? await ctx.db.query("generations").withIndex("by_workspaceUid_and_kind_and_createdAt", (q) => q.eq("workspaceUid", workspaceUid).eq("kind", kind)).order("desc").take(take)
      : await ctx.db.query("generations").withIndex("by_workspaceUid_and_createdAt", (q) => q.eq("workspaceUid", workspaceUid)).order("desc").take(take);
    return rows.map(generationView);
  },
});

export const getGeneration = query({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    return generationView(await mustGeneration(ctx, workspaceUid, uid));
  },
});

export const createGeneration = mutation({
  args: {
    workspaceUid: v.string(), uid: v.string(), kind: v.string(), modality: v.string(), prompt: v.string(), resolvedPrompt: v.string(),
    model: modelRef, estimate: v.any(), warnings: v.array(v.any()), params: v.any(), elementIds: v.array(v.string()),
    parentId: v.union(v.null(), v.string()), files: v.array(fileRef), favorite: v.boolean(), durationMs: v.union(v.null(), v.number()), createdAt: v.string(),
  },
  handler: async (ctx, fields) => {
    await requireOwner(ctx);
    const workspace = await mustWorkspace(ctx, fields.workspaceUid);
    const id = await ctx.db.insert("generations", fields);
    const counts = { ...workspace.counts, generations: workspace.counts.generations + 1 };
    if (fields.kind === "image") counts.images += 1;
    if (fields.kind === "video" || fields.kind === "talking") counts.videos += 1;
    await touch(ctx, workspace, fields.createdAt, { counts, spentUsd: workspace.spentUsd + amountOf(fields.estimate) });
    return generationView((await ctx.db.get(id))!);
  },
});

export const updateGeneration = mutation({
  args: { workspaceUid: v.string(), uid: v.string(), favorite: v.optional(v.boolean()), title: v.optional(v.string()) },
  handler: async (ctx, { workspaceUid, uid, favorite, title }) => {
    await requireOwner(ctx);
    await mustWorkspace(ctx, workspaceUid);
    const generation = await mustGeneration(ctx, workspaceUid, uid);
    const changes: Partial<Doc<"generations">> = {};
    if (favorite !== undefined) changes.favorite = favorite;
    if (title !== undefined) changes.title = title;
    await ctx.db.patch(generation._id, changes);
    return generationView((await ctx.db.get(generation._id))!);
  },
});

export const deleteGeneration = mutation({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    await requireOwner(ctx);
    const workspace = await mustWorkspace(ctx, workspaceUid);
    const generation = await mustGeneration(ctx, workspaceUid, uid);
    await ctx.db.delete(generation._id);
    const counts = { ...workspace.counts, generations: Math.max(0, workspace.counts.generations - 1) };
    if (generation.kind === "image") counts.images = Math.max(0, counts.images - 1);
    if (generation.kind === "video" || generation.kind === "talking") counts.videos = Math.max(0, counts.videos - 1);
    await ctx.db.patch(workspace._id, { counts, spentUsd: Math.max(0, workspace.spentUsd - amountOf(generation.estimate)) });
    return generation.files.map((file) => file.file);
  },
});

// ------------------------------------------------------------------ import from the former JSON files

/** Idempotent raw inserts used by `npm run convex:import`: ids and timestamps are kept exactly as on disk. */
export const importWorkspace = mutation({
  args: {
    uid: v.string(), name: v.string(), description: v.string(), settings: v.any(), createdAt: v.string(), updatedAt: v.string(),
    counts: v.object({ elements: v.number(), generations: v.number(), images: v.number(), videos: v.number() }), spentUsd: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (await findWorkspace(ctx, args.uid)) return false;
    await ctx.db.insert("workspaces", args);
    return true;
  },
});

export const importElement = mutation({
  args: {
    uid: v.string(), workspaceUid: v.string(), kind: v.string(), name: v.string(), description: v.string(), tags: v.array(v.string()),
    voice: v.optional(v.any()), images: v.array(imageRef), createdAt: v.string(), updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (await ctx.db.query("elements").withIndex("by_uid", (q) => q.eq("uid", args.uid)).unique()) return false;
    await ctx.db.insert("elements", args);
    return true;
  },
});

export const importGeneration = mutation({
  args: {
    uid: v.string(), workspaceUid: v.string(), kind: v.string(), modality: v.string(), prompt: v.string(), resolvedPrompt: v.string(),
    model: modelRef, estimate: v.any(), warnings: v.array(v.any()), params: v.any(), elementIds: v.array(v.string()),
    parentId: v.union(v.null(), v.string()), files: v.array(fileRef), favorite: v.boolean(), title: v.optional(v.string()),
    durationMs: v.union(v.null(), v.number()), createdAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (await ctx.db.query("generations").withIndex("by_uid", (q) => q.eq("uid", args.uid)).unique()) return false;
    await ctx.db.insert("generations", args);
    return true;
  },
});

export const hasMedia = query({
  args: { workspaceUid: v.string(), file: v.string() },
  handler: async (ctx, { workspaceUid, file }) => {
    await requireOwner(ctx);
    return (await ctx.db.query("media").withIndex("by_workspaceUid_and_file", (q) => q.eq("workspaceUid", workspaceUid).eq("file", file)).unique()) !== null;
  },
});
