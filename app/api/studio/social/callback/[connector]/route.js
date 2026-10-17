import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/require-owner';
import { describeError } from '@/lib/studio/service.mjs';
import { getStudioStore } from '@/lib/studio/backend.mjs';
import { getSocialStore } from '@/lib/social/store.mjs';
import { completeConnection } from '@/lib/social/service.mjs';
import { verifyState } from '@/lib/social/crypto.mjs';

export const dynamic = 'force-dynamic';

const COOKIE = 'social_oauth_nonce';

/** OAuth return URL: Meta and TikTok send the browser here, then we land back on the project's social screen. */
export async function GET(request, context) {
  if (!(await requireOwner())) return Response.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
  const { connector } = await context.params;
  const url = new URL(request.url);
  const back = (query) => {
    const response = NextResponse.redirect(new URL(`/studio/social?${new URLSearchParams(query)}`, url.origin));
    response.cookies.delete({ name: COOKIE, path: '/api/studio/social' });
    return response;
  };
  const denied = url.searchParams.get('error_description') || url.searchParams.get('error_reason') || url.searchParams.get('error');
  if (denied) return back({ error: `Connexion annulée : ${denied}` });
  try {
    const result = await completeConnection({
      social: getSocialStore(getStudioStore()),
      connectorId: connector,
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
      nonce: request.cookies.get(COOKIE)?.value,
      requestOrigin: url.origin,
    });
    return back({ connected: String(result.accounts.length), workspace: result.workspaceId });
  } catch (error) {
    const { status, body } = describeError(error);
    if (status >= 500) console.error('[social-callback]', error);
    return back({ error: body.error });
  }
}
