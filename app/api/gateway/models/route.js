import { groupModelsByModality } from '@/lib/gateway/catalog.mjs';
import { GenerationError, loadGatewayCatalog } from '@/lib/gateway/engine.mjs';
import { requireOwner } from '@/lib/server/require-owner';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await requireOwner())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const models = await loadGatewayCatalog({ fetchOptions: { next: { revalidate: 900 } } });
    return Response.json({ updatedAt: new Date().toISOString(), models, byModality: groupModelsByModality(models) });
  } catch (error) {
    const status = error instanceof GenerationError ? error.status : 502;
    return Response.json({ error: 'Gateway catalog unavailable' }, { status });
  }
}
