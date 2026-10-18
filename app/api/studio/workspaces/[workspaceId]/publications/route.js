import { readJsonBody, studioRoute } from '@/lib/server/studio-api';
import { getSocialStore } from '@/lib/social/store.mjs';
import { publicPublication } from '@/lib/social/service.mjs';
import { publish } from '@/lib/social/runtime.mjs';

export const dynamic = 'force-dynamic';
// Instagram and TikTok process media on their side: give the first status checks room to finish.
export const maxDuration = 60;

export const GET = studioRoute(async ({ request, params, store }) => {
  const generationId = new URL(request.url).searchParams.get('generationId') || undefined;
  const publications = await getSocialStore(store).listPublications(params.workspaceId, { generationId });
  return Response.json({ publications: publications.map(publicPublication) });
});

export const POST = studioRoute(async ({ request, params, store }) => {
  const publications = await publish({ social: getSocialStore(store), workspaceId: params.workspaceId, input: await readJsonBody(request) });
  return Response.json({ publications }, { status: 201 });
});
