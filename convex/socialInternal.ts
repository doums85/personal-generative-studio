import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import * as db from "./lib/socialDb";

/**
 * The same publishing operations without the owner check, for the actions that Convex itself runs (a scheduled
 * send has no user). They are internal: nothing outside this deployment can call them.
 */

export const getAccount = internalQuery({ args: db.accountRef, handler: (ctx, args) => db.getAccount(ctx, args) });
export const updateCredentials = internalMutation({ args: db.credentialsArgs, handler: (ctx, args) => db.updateCredentials(ctx, args) });
export const markNeedsReconnect = internalMutation({ args: db.accountRef, handler: (ctx, args) => db.markNeedsReconnect(ctx, args) });
export const getPublication = internalQuery({ args: db.publicationRef, handler: (ctx, args) => db.getPublication(ctx, args) });
export const createPublication = internalMutation({ args: db.publicationFields, handler: (ctx, fields) => db.createPublication(ctx, fields) });
export const updatePublication = internalMutation({ args: db.updatePublicationArgs, handler: (ctx, args) => db.updatePublication(ctx, args) });
export const claimScheduled = internalMutation({ args: db.claimArgs, handler: (ctx, args) => db.claimScheduled(ctx, args) });
export const deletePublication = internalMutation({ args: db.publicationRef, handler: (ctx, args) => db.deletePublication(ctx, args) });
export const listStuck = internalQuery({ args: { dueBefore: v.string(), staleBefore: v.string() }, handler: (ctx, args) => db.listStuck(ctx, args) });
export const failInterrupted = internalMutation({ args: { workspaceUid: v.string(), uid: v.string(), updatedAt: v.string() }, handler: (ctx, args) => db.failInterrupted(ctx, args) });
