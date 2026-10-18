import http from 'node:http';

export const FAKE_PORT = 4311;
export const FAKE_URL = `http://127.0.0.1:${FAKE_PORT}`;

/** What Convex needs to know to talk to the fake instead of Meta and TikTok (see scripts/test-convex.mjs). */
export const CONVEX_PLATFORM_ENV = {
  SOCIAL_TOKEN_SECRET: 'social-secret-0123456789-abcdefghij',
  STUDIO_MEDIA_SECRET: 'media-secret-0123456789-abcdefghij',
  STUDIO_PUBLIC_URL: FAKE_URL,
  META_APP_ID: 'meta-id',
  META_APP_SECRET: 'meta-secret',
  TIKTOK_CLIENT_KEY: 'tt-key',
  TIKTOK_CLIENT_SECRET: 'tt-secret',
  META_GRAPH_BASE_URL: FAKE_URL,
  TIKTOK_API_BASE_URL: FAKE_URL,
};

/** What Convex needs to sign the owner in during the tests (see scripts/test-convex.mjs). */
export const CONVEX_AUTH_ENV = {
  ALLOWED_EMAILS: 'owner@example.com',
  STUDIO_PUBLIC_URL: FAKE_URL,
};

/** A minimal Meta Graph API: records every call; Reels need `reelPolls` status checks before they are ready. */
export async function startFakePlatform({ reelPolls = 2 } = {}) {
  const calls = [];
  const containers = new Map();
  let counter = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, FAKE_URL);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    calls.push({ method: req.method, path: url.pathname, body, query: Object.fromEntries(url.searchParams) });
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const route = url.pathname.replace(/^\/v[\d.]+\//, '');
    const [id, action] = route.split('/');
    if (action === 'photos') return reply(200, { id: `photo${++counter}`, post_id: `${id}_${++counter}` });
    if (action === 'media') {
      const containerId = `c${++counter}`;
      containers.set(containerId, { polls: 0, needs: body.media_type === 'REELS' ? reelPolls : 0 });
      return reply(200, { id: containerId });
    }
    if (action === 'media_publish') return reply(200, { id: `igpost${++counter}` });
    if (containers.has(id)) {
      const container = containers.get(id);
      container.polls += 1;
      return reply(200, { status_code: container.polls > container.needs ? 'FINISHED' : 'IN_PROGRESS' });
    }
    if (id?.startsWith('igpost')) return reply(200, { permalink: `https://www.instagram.com/p/${id}/` });
    return reply(404, { error: { message: `Unhandled ${url.pathname}` } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(FAKE_PORT, '127.0.0.1', resolve); });
  return { calls, close: () => new Promise((resolve) => server.close(resolve)), reset: () => { calls.length = 0; } };
}
