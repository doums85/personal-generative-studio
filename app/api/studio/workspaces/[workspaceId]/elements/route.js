import { readJsonBody, studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ request, params, store }) => {
  const kind = new URL(request.url).searchParams.get('kind') || undefined;
  return Response.json({ elements: await store.listElements(params.workspaceId, { kind }) });
});

export const POST = studioRoute(async ({ request, params, store }) => {
  const { images = [], ...input } = await readJsonBody(request);
  const element = await store.createElement(params.workspaceId, input, { images });
  return Response.json({ element }, { status: 201 });
});
