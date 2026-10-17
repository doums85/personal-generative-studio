import { cronAuthorized } from '@/lib/social/schedule.mjs';
import { runDuePublications } from '@/lib/social/service.mjs';
import { getSocialStore } from '@/lib/social/store.mjs';
import { getStudioStore } from '@/lib/studio/store.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cron entry point (Vercel Cron or any scheduler): sends the publications that are due. Authenticated by CRON_SECRET, not by a session. */
async function run(request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: 'CRON_SECRET is not set', code: 'not_configured' }, { status: 503 });
  if (!cronAuthorized(request.headers.get('authorization'))) return Response.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
  const touched = await runDuePublications({ social: getSocialStore(getStudioStore()) });
  return Response.json({ handled: touched.length, publications: touched.map(({ id, platform, status }) => ({ id, platform, status })) });
}

export const GET = run;
export const POST = run;
