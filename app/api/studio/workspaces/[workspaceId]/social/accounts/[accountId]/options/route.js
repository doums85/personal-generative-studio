import { studioRoute } from '@/lib/server/studio-api';
import { getSocialStore } from '@/lib/social/store.mjs';
import { accountOptions } from '@/lib/social/service.mjs';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ params, store }) => Response.json({ options: await accountOptions({ social: getSocialStore(store), workspaceId: params.workspaceId, accountId: params.accountId }) }));
