import { ConvexHttpClient } from 'convex/browser';
import { isAllowedEmail } from '../access-control.mjs';
import { api } from '../convex/api.mjs';

const CACHE_MS = 30 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map();

/**
 * Who is behind a Convex Auth session token, as the owner session the rest of the app expects (`{ user: { email } }`),
 * or null when the token is missing, expired, revoked, or belongs to an address that is not the owner's.
 * Convex checks the token; the answer is remembered for a few seconds so a page does not cost one round trip per request.
 */
export async function ownerFromToken(token, { env = process.env, now = Date.now, createClient = (url) => new ConvexHttpClient(url, { logger: false }) } = {}) {
  if (!token) return null;
  const url = env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  const hit = cache.get(token);
  if (hit && hit.until > now()) return hit.owner;

  let email = null;
  try {
    const client = createClient(url);
    client.setAuth(token);
    email = (await client.query(api.session.viewer, {}))?.email ?? null;
  } catch {
    return null; // Convex unreachable or token refused: not signed in, and nothing worth remembering.
  }
  const owner = isAllowedEmail(email, env.ALLOWED_EMAILS ?? '') ? { user: { email } } : null;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(token, { owner, until: now() + CACHE_MS });
  return owner;
}

export function clearOwnerCache() {
  cache.clear();
}
