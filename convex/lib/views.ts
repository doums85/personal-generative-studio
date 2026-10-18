import type { Doc } from "../_generated/dataModel";

/** Documents as the rest of the studio knows them: `id` is the UUID, Convex's own ids and internal links stay hidden. */

export function workspaceView(doc: Doc<"workspaces">) {
  return { id: doc.uid, name: doc.name, description: doc.description, settings: doc.settings, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}

export function summaryView(doc: Doc<"workspaces">) {
  return { ...workspaceView(doc), counts: doc.counts, spentUsd: doc.spentUsd };
}

export function elementView(doc: Doc<"elements">) {
  const { _id, _creationTime, uid, workspaceUid, ...rest } = doc; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { id: uid, ...rest };
}

export function generationView(doc: Doc<"generations">) {
  const { _id, _creationTime, uid, workspaceUid, ...rest } = doc; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { id: uid, ...rest };
}

/** An account as the web app and the MCP tools see it: never with its credentials. */
export function accountView(doc: Doc<"socialAccounts">) {
  const { _id, _creationTime, uid, workspaceUid, credentials, ...rest } = doc; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { id: uid, ...rest };
}

export function publicationView(doc: Doc<"publications">) {
  const { _id, _creationTime, uid, workspaceUid, scheduledFunctionId, ...rest } = doc; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { id: uid, ...rest };
}
