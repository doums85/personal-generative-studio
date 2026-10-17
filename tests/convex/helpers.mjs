import { randomUUID } from 'node:crypto';
import { loadLocalEnv } from '../../mcp/server.mjs';
import { ConvexService, convexSettings } from '../../lib/convex/service.mjs';
import { ConvexSocialStore } from '../../lib/convex/social-store.mjs';
import { ConvexStudioStore } from '../../lib/convex/studio-store.mjs';

loadLocalEnv();

export const ENV = {
  ...process.env,
  SOCIAL_TOKEN_SECRET: 'social-secret-0123456789-abcdefghij',
  STUDIO_PUBLIC_URL: 'https://studio.example.com',
  STUDIO_MEDIA_SECRET: 'media-secret-0123456789-abcdefghij',
};

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
export const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

export function settings() {
  const found = convexSettings(ENV);
  if (!found) throw new Error('CONVEX_URL is not set: run these tests with `npm run test:convex`.');
  return found;
}

let counter = 0;

/** Stores bound to the local deployment; the clock ticks forward so records sort in creation order. */
export function createStores() {
  const service = new ConvexService(settings());
  const studio = new ConvexStudioStore({ service, now: () => new Date(Date.now() + counter++) });
  const social = new ConvexSocialStore(studio, { env: ENV });
  const created = [];
  return {
    service,
    studio,
    social,
    /** Workspaces made by a test are removed at the end so the local deployment stays clean. */
    async workspace(name = 'Test') {
      const workspace = await studio.createWorkspace({ name: `${name} ${randomUUID().slice(0, 8)}` });
      created.push(workspace.id);
      return workspace;
    },
    async cleanup() {
      for (const id of created) await studio.deleteWorkspace(id).catch(() => {});
    },
  };
}

export async function eventually(check, { timeout = 15000, every = 250 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) return null;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}
