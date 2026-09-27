import { loadCatalogCached, readJsonBody, studioRoute } from '@/lib/server/studio-api';
import { publicMediaConfig } from '@/lib/studio/public-media.mjs';
import { generateTalkingVideo } from '@/lib/studio/talking.mjs';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export const POST = studioRoute(async ({ request, params, store }) => {
  const generation = await generateTalkingVideo({ store, workspaceId: params.workspaceId, request: await readJsonBody(request), loadCatalog: loadCatalogCached, publicMedia: publicMediaConfig() });
  return Response.json({ generation }, { status: 201 });
});
