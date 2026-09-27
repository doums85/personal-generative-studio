import { loadGatewayCatalog } from '@/lib/gateway/engine.mjs';
import { describeError } from '@/lib/studio/service.mjs';
import { getStudioStore } from '@/lib/studio/store.mjs';
import { requireOwner } from '@/lib/server/require-owner';

/**
 * Wraps a studio route handler: enforces the owner session, resolves dynamic params,
 * exposes the shared store and converts thrown errors into JSON responses.
 */
export function studioRoute(handler) {
  return async function route(request, context) {
    if (!(await requireOwner())) return Response.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
    const params = context?.params ? await context.params : {};
    try {
      return await handler({ request, params, store: getStudioStore() });
    } catch (error) {
      const { status, body } = describeError(error);
      if (status >= 500) console.error('[studio-api]', error);
      return Response.json(body, { status });
    }
  };
}

export async function readJsonBody(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
  return body;
}

export function loadCatalogCached() {
  return loadGatewayCatalog({ fetchOptions: { next: { revalidate: 900 } } });
}
