import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The studio's documents keep the shape they had as JSON files: every record has its own string `uid`
 * (a UUID, the id used in URLs, `studio://` references and exports), so ids survive a migration from disk.
 * Convex's own `_id` is never exposed.
 */
const mediaRef = v.object({
  id: v.string(),
  file: v.string(),
  mediaType: v.string(),
  bytes: v.number(),
});

export default defineSchema({
  // Accounts, sessions and sign-in attempts of Convex Auth (see auth.ts).
  ...authTables,
  workspaces: defineTable({
    uid: v.string(),
    name: v.string(),
    description: v.string(),
    settings: v.any(),
    // Maintained by the mutations that add or remove children, so a summary never scans a library.
    counts: v.object({ elements: v.number(), generations: v.number(), images: v.number(), videos: v.number() }),
    spentUsd: v.number(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_uid", ["uid"])
    .index("by_updatedAt", ["updatedAt"]),

  elements: defineTable({
    uid: v.string(),
    workspaceUid: v.string(),
    kind: v.string(),
    name: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    voice: v.optional(v.any()),
    images: v.array(mediaRef.extend({ source: v.optional(v.string()), createdAt: v.string() })),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_uid", ["uid"])
    .index("by_workspaceUid_and_updatedAt", ["workspaceUid", "updatedAt"]),

  generations: defineTable({
    uid: v.string(),
    workspaceUid: v.string(),
    kind: v.string(),
    modality: v.string(),
    prompt: v.string(),
    resolvedPrompt: v.string(),
    model: v.union(v.null(), v.object({ id: v.string(), name: v.optional(v.string()), provider: v.optional(v.string()) })),
    estimate: v.any(),
    warnings: v.array(v.any()),
    params: v.any(),
    elementIds: v.array(v.string()),
    parentId: v.union(v.null(), v.string()),
    files: v.array(mediaRef.extend({ role: v.string() })),
    favorite: v.boolean(),
    title: v.optional(v.string()),
    durationMs: v.union(v.null(), v.number()),
    createdAt: v.string(),
  })
    .index("by_uid", ["uid"])
    .index("by_workspaceUid_and_createdAt", ["workspaceUid", "createdAt"])
    .index("by_workspaceUid_and_kind_and_createdAt", ["workspaceUid", "kind", "createdAt"]),

  // One row per stored file; the bytes live in Convex file storage.
  media: defineTable({
    workspaceUid: v.string(),
    file: v.string(),
    storageId: v.id("_storage"),
    mediaType: v.string(),
    bytes: v.number(),
    createdAt: v.string(),
  }).index("by_workspaceUid_and_file", ["workspaceUid", "file"]),

  socialAccounts: defineTable({
    uid: v.string(),
    workspaceUid: v.string(),
    platform: v.string(),
    externalId: v.string(),
    name: v.string(),
    handle: v.union(v.null(), v.string()),
    avatarUrl: v.union(v.null(), v.string()),
    status: v.string(),
    // AES-GCM envelope produced by the server; Convex only ever stores the ciphertext.
    credentials: v.string(),
    connectedAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_uid", ["uid"])
    .index("by_workspaceUid_and_platform_and_externalId", ["workspaceUid", "platform", "externalId"]),

  publications: defineTable({
    uid: v.string(),
    workspaceUid: v.string(),
    generationId: v.string(),
    fileId: v.string(),
    accountId: v.string(),
    platform: v.string(),
    accountName: v.string(),
    caption: v.string(),
    options: v.any(),
    media: v.any(),
    status: v.string(),
    state: v.any(),
    remoteId: v.union(v.null(), v.string()),
    url: v.union(v.null(), v.string()),
    draft: v.boolean(),
    error: v.union(v.null(), v.string()),
    scheduledAt: v.optional(v.string()),
    // The Convex scheduled function that will send it; cancelled when the publication is deleted.
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    startedAt: v.union(v.null(), v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    publishedAt: v.union(v.null(), v.string()),
  })
    .index("by_uid", ["uid"])
    .index("by_workspaceUid_and_createdAt", ["workspaceUid", "createdAt"])
    .index("by_workspaceUid_and_generationId_and_createdAt", ["workspaceUid", "generationId", "createdAt"])
    // The watchdog looks for scheduled posts that missed their time and processing posts nobody is following.
    .index("by_status_and_scheduledAt", ["status", "scheduledAt"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
});
