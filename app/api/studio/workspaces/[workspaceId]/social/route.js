import { studioRoute } from '@/lib/server/studio-api';
import { getSocialStore } from '@/lib/social/store.mjs';
import { socialOverview } from '@/lib/social/service.mjs';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ request, params, store }) => Response.json(await socialOverview({
  social: getSocialStore(store),
  workspaceId: params.workspaceId,
  requestOrigin: new URL(request.url).origin,
})));
