import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

/**
 * Who the signed-in visitor is, for the web app to check against the owner's address. This is the one public function
 * that serves visitors rather than the studio's servers, so it only answers for tokens Convex Auth itself issued
 * (never for the servers' own tokens), only while their session is alive, and only returns the address.
 */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.issuer !== process.env.CONVEX_SITE_URL) return null;
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    // The token alone stays valid until it expires (an hour): the session behind it must still exist, so that
    // signing out, or changing the password, ends the access within seconds.
    const sessionId = await getAuthSessionId(ctx);
    const session = sessionId ? await ctx.db.get(sessionId) : null;
    if (!session) return null;
    const user = await ctx.db.get(userId);
    return user ? { email: user.email ?? null } : null;
  },
});
