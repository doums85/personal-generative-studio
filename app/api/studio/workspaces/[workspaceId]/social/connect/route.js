import { readJsonBody, studioRoute } from '@/lib/server/studio-api';
import { getSocialStore } from '@/lib/social/store.mjs';
import { startConnection } from '@/lib/social/service.mjs';

export const dynamic = 'force-dynamic';

const NONCE_COOKIE = 'social_oauth_nonce';

/** Starts the OAuth flow for a network; the nonce cookie ties the callback to this browser. */
export const POST = studioRoute(async ({ request, params, store }) => {
  const { connector } = await readJsonBody(request);
  const origin = new URL(request.url).origin;
  const { url, nonce } = await startConnection({ social: getSocialStore(store), workspaceId: params.workspaceId, connectorId: connector, requestOrigin: origin });
  const secure = origin.startsWith('https://') ? '; Secure' : '';
  return Response.json({ url }, { headers: { 'Set-Cookie': `${NONCE_COOKIE}=${nonce}; Path=/api/studio/social; HttpOnly; SameSite=Lax; Max-Age=600${secure}` } });
});
