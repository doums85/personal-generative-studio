import { studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ request, params, store }) => {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || undefined;
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
  return Response.json({ generations: await store.listGenerations(params.workspaceId, { kind, limit }) });
});
