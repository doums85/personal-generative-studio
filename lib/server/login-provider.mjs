/**
 * Which system signs the owner in: `password` (default, NextAuth with AUTH_PASSWORD_HASH) or `convex` (Convex Auth,
 * with the account and sessions stored in Convex). Chosen with LOGIN_PROVIDER so the old login stays available until
 * the Convex one has been checked.
 */
export function loginProvider(env = process.env) {
  const wanted = String(env.LOGIN_PROVIDER ?? '').trim().toLowerCase();
  if (wanted !== 'convex') return 'password';
  if (!env.CONVEX_URL && !env.NEXT_PUBLIC_CONVEX_URL) {
    throw new Error('LOGIN_PROVIDER=convex needs CONVEX_URL (and STUDIO_SERVICE_PRIVATE_KEY): run `npm run convex:dev` or set them.');
  }
  return 'convex';
}
