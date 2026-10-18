import { auth } from '@/auth';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { headers } from 'next/headers';
import { isAllowedSession, isLocalPreview } from '@/lib/access-control.mjs';
import { ownerFromToken } from '@/lib/server/convex-owner.mjs';
import { loginProvider } from '@/lib/server/login-provider.mjs';

export async function requireOwner() {
  const headerList = await headers();
  const hostname = (headerList.get('host') || '').split(':')[0];
  if (isLocalPreview({
    enabled: process.env.LOCAL_PREVIEW,
    nodeEnv: process.env.NODE_ENV,
    hostname,
  })) {
    return { user: { email: 'local-preview@localhost' } };
  }

  if (loginProvider() === 'convex') return ownerFromToken(await convexAuthNextjsToken());

  const session = await auth();
  return isAllowedSession(session) ? session : null;
}
