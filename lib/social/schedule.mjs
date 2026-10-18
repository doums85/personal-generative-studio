import { timingSafeEqual } from 'node:crypto';

/**
 * How scheduled publications get sent. With Convex (CONVEX_URL set) Convex's own scheduler sends each one at its
 * exact time, so nothing here is needed. Self-hosted servers tick every minute on their own;
 * serverless hosts (Vercel) have no resident process, so an external cron must call
 * `/api/studio/social/run-due` with `Authorization: Bearer $CRON_SECRET`.
 */
export function schedulerStatus(env = process.env) {
  if (env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL) return { mode: 'convex', active: true };
  const cron = Boolean(env.CRON_SECRET);
  if (env.VERCEL || env.SOCIAL_SCHEDULER === 'off') return { mode: cron ? 'cron' : 'none', active: cron };
  return { mode: 'interval', active: true, cron };
}

export function cronAuthorized(authorization, env = process.env) {
  const secret = env.CRON_SECRET || '';
  const expected = `Bearer ${secret}`;
  const given = String(authorization || '');
  return secret.length > 0 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
