import { auth } from '@/auth';
import { headers } from 'next/headers';
import { isAllowedSession, isLocalPreview } from '@/lib/access-control.mjs';

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

  const session = await auth();
  return isAllowedSession(session) ? session : null;
}
