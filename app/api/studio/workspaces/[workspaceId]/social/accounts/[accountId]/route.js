import { studioRoute } from '@/lib/server/studio-api';
import { getSocialStore } from '@/lib/social/store.mjs';

export const dynamic = 'force-dynamic';

export const DELETE = studioRoute(async ({ params, store }) => {
  await getSocialStore(store).removeAccount(params.workspaceId, params.accountId);
  return new Response(null, { status: 204 });
});
