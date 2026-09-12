import { auth } from '@/auth';
import { isAllowedSession } from '@/lib/access-control.mjs';

export async function requireOwner() {
  const session = await auth();
  return isAllowedSession(session) ? session : null;
}
