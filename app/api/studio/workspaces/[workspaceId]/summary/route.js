import { studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ params, store }) => {
  const [workspace, elements, generations] = await Promise.all([
    store.workspaceSummary(params.workspaceId),
    store.listElements(params.workspaceId),
    store.listGenerations(params.workspaceId, { limit: 60 }),
  ]);
  return Response.json({ workspace, elements, generations });
});
