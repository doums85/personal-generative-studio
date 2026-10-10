import { loadCatalogCached, readJsonBody, studioRoute } from '@/lib/server/studio-api';
import { estimateInWorkspace } from '@/lib/studio/service.mjs';

export const dynamic = 'force-dynamic';

export const POST = studioRoute(async ({ request, params, store }) => {
  const result = await estimateInWorkspace({ store, workspaceId: params.workspaceId, request: await readJsonBody(request), loadCatalog: loadCatalogCached });
  const limit = Number(process.env.MAX_GENERATION_COST_USD);
  return Response.json({ ...result, maxCostUsd: Number.isFinite(limit) ? limit : null, overBudget: Number.isFinite(limit) && result.estimate.amount !== null && result.estimate.amount > limit });
});
