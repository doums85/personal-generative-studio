import { readJsonBody, studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ params, store }) => Response.json({ element: await store.getElement(params.workspaceId, params.elementId) }));

export const PATCH = studioRoute(async ({ request, params, store }) => {
  const { addImages = [], removeImageIds = [], primaryImageId, ...patch } = await readJsonBody(request);
  const element = await store.updateElement(params.workspaceId, params.elementId, patch, { addImages, removeImageIds, primaryImageId });
  return Response.json({ element });
});

export const DELETE = studioRoute(async ({ params, store }) => {
  await store.deleteElement(params.workspaceId, params.elementId);
  return new Response(null, { status: 204 });
});
