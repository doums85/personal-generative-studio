import { readJsonBody, studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ params, store }) => Response.json({ workspace: await store.workspaceSummary(params.workspaceId) }));

export const PATCH = studioRoute(async ({ request, params, store }) => {
  await store.updateWorkspace(params.workspaceId, await readJsonBody(request));
  return Response.json({ workspace: await store.workspaceSummary(params.workspaceId) });
});

export const DELETE = studioRoute(async ({ params, store }) => {
  await store.deleteWorkspace(params.workspaceId);
  return new Response(null, { status: 204 });
});
