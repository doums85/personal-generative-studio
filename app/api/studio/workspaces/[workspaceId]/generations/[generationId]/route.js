import { readJsonBody, studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ params, store }) => Response.json({ generation: await store.getGeneration(params.workspaceId, params.generationId) }));

export const PATCH = studioRoute(async ({ request, params, store }) => Response.json({ generation: await store.updateGeneration(params.workspaceId, params.generationId, await readJsonBody(request)) }));

export const DELETE = studioRoute(async ({ params, store }) => {
  await store.deleteGeneration(params.workspaceId, params.generationId);
  return new Response(null, { status: 204 });
});
