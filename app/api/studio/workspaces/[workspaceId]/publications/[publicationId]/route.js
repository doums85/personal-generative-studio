import { studioRoute } from '@/lib/server/studio-api';
import { getSocialStore } from '@/lib/social/store.mjs';
import { follow } from '@/lib/social/runtime.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Returns the publication; without Convex it checks with the platform first when it is still processing. */
export const GET = studioRoute(async ({ params, store }) => Response.json({ publication: await follow({ social: getSocialStore(store), workspaceId: params.workspaceId, publicationId: params.publicationId }) }));

export const DELETE = studioRoute(async ({ params, store }) => {
  await getSocialStore(store).deletePublication(params.workspaceId, params.publicationId);
  return new Response(null, { status: 204 });
});
