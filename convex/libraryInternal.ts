import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { StudioError } from "./lib/owner";
import { generationView } from "./lib/views";

/** Library reads for the publishing actions (no owner check: internal functions are only reachable from inside Convex). */
export const getGeneration = internalQuery({
  args: { workspaceUid: v.string(), uid: v.string() },
  handler: async (ctx, { workspaceUid, uid }) => {
    const generation = await ctx.db.query("generations").withIndex("by_uid", (q) => q.eq("uid", uid)).unique();
    if (!generation || generation.workspaceUid !== workspaceUid) throw new StudioError("generation_not_found", "Generation not found");
    return generationView(generation);
  },
});
