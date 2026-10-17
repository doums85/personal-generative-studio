import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

/** `iss` of the tokens the studio's own servers (web app, MCP server) sign; must match lib/convex/constants.mjs. */
export const SERVICE_ISSUER = "https://studio.internal/service";
export const SERVICE_AUDIENCE = "studio-server";

export class StudioError extends ConvexError<{ code: string; message: string }> {
  constructor(code: string, message: string) {
    super({ code, message });
  }
}

/**
 * Every public function starts here. The studio has a single owner, so the only identities accepted are
 * the ones the owner's own servers sign. Without a configured key there is no identity at all and every call fails.
 */
export async function requireOwner(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.issuer !== SERVICE_ISSUER) throw new StudioError("unauthorized", "Unauthorized");
}
