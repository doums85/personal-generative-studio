import { createAccount, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { isAllowedEmail, normalizeEmail } from "./lib/allowed";
import { StudioError, requireOwner } from "./lib/owner";

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Creates the owner's account, or replaces its password (which also signs out every device). Only the studio's own
 * server can call it (`npm run convex:create-owner`); there is no sign-up flow for visitors.
 */
export const setOwnerPassword = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ created: boolean }> => {
    await requireOwner(ctx);
    const email = normalizeEmail(args.email);
    if (!isAllowedEmail(email)) throw new StudioError("invalid_request", "Cette adresse n'est pas dans ALLOWED_EMAILS (variable du déploiement Convex : npm run convex:auth-setup).");
    if (args.password.length < MIN_PASSWORD_LENGTH) throw new StudioError("invalid_request", `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);

    let existing: Awaited<ReturnType<typeof retrieveAccount>> | null = null;
    try {
      existing = await retrieveAccount(ctx, { provider: "password", account: { id: email } });
    } catch {
      existing = null;
    }
    if (existing) {
      await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: args.password } });
      await invalidateSessions(ctx, { userId: existing.user._id });
      return { created: false };
    }
    await createAccount(ctx, { provider: "password", account: { id: email, secret: args.password }, profile: { email }, shouldLinkViaEmail: false, shouldLinkViaPhone: false });
    return { created: true };
  },
});
