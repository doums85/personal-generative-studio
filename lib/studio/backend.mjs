import { ConvexStudioStore } from '../convex/studio-store.mjs';
import { ConvexService, convexSettings, getConvexService } from '../convex/service.mjs';
import { StudioStore, resolveDataDir } from './store.mjs';

/**
 * Picks where the studio keeps its data: Convex when `CONVEX_URL` is set (production), otherwise the JSON
 * files under `STUDIO_DATA_DIR` (an offline fallback that also serves as the source of `npm run convex:import`).
 */
export function createStudioStore({ env = process.env, root, ...options } = {}) {
  const settings = convexSettings(env);
  if (settings) return new ConvexStudioStore({ service: options.service || new ConvexService(settings), ...options });
  return new StudioStore({ rootDir: resolveDataDir(env, root), ...options });
}

let sharedStore = null;

/** Process-wide store used by API routes; tests build their own instances. */
export function getStudioStore() {
  if (!sharedStore) {
    const service = getConvexService();
    sharedStore = service ? new ConvexStudioStore({ service }) : new StudioStore({ rootDir: resolveDataDir() });
  }
  return sharedStore;
}
