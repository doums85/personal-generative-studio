import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { isAllowedEmail, normalizeEmail } from "./lib/allowed";

/**
 * Sign-in for the studio's owner (used when the web app runs with LOGIN_PROVIDER=convex).
 *
 * Accounts, password hashes, sessions and failed-attempt rate limiting live in Convex. Nobody can create an
 * account from the outside: the only flow accepted here is `signIn`, and only for the addresses in `ALLOWED_EMAILS`.
 * The owner's account is created or its password changed by the studio's own server (`npm run convex:create-owner`).
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(params.email);
        // One answer for every refusal: it must not reveal which addresses are allowed or have an account.
        if (params.flow !== "signIn" || !isAllowedEmail(email)) throw new Error("Invalid credentials");
        return { email };
      },
    }),
  ],
});
