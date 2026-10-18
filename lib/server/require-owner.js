import { auth } from '@/auth';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { headers } from 'next/headers';
import { isAllowedSession, isLocalPreview } from '@/lib/access-control.mjs';
import { ownerFromToken } from '@/lib/server/convex-owner.mjs';
import { loginProvider } from '@/lib/server/login-provider.mjs';

/** Address of the stand-in owner when LOCAL_PREVIEW skips the login (there is no session to end then). */
export const PREVIEW_EMAIL = 'local-preview@localhost';

export async function requireOwner() {
  const headerList = await headers();
  const hostname = (headerList.get('host') || '').split(':')[0];
  if (isLocalPreview({
    enabled: process.env.LOCAL_PREVIEW,
    nodeEnv: process.env.NODE_ENV,
    hostname,
  })) {
    return { user: { email: PREVIEW_EMAIL } };
  }

  if (loginProvider() === 'convex') return ownerFromToken(await convexAuthNextjsToken());

  const session = await auth();
  return isAllowedSession(session) ? session : null;
}
