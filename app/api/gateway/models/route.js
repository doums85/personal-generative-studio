import { groupModelsByModality, normalizeGatewayCatalog } from '@/lib/gateway/catalog.mjs';
import { requireOwner } from '@/lib/server/require-owner';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await requireOwner())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    next: { revalidate: 900 },
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return Response.json({ error: 'Gateway catalog unavailable' }, { status: 502 });

  const models = normalizeGatewayCatalog(await response.json());
  return Response.json({ updatedAt: new Date().toISOString(), models, byModality: groupModelsByModality(models) });
}
