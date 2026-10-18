import { signOut } from '@/auth';
import { PREVIEW_EMAIL, requireOwner } from '@/lib/server/require-owner';
import { loginProvider } from '@/lib/server/login-provider.mjs';

export const dynamic = 'force-dynamic';

/** Who is signed in and with which login system, so the header can offer "Se déconnecter" (and say who it ends). */
export async function GET() {
  const session = await requireOwner();
  if (!session) return Response.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
  const email = session.user?.email ?? null;
  return Response.json({ email, provider: email === PREVIEW_EMAIL ? 'preview' : loginProvider() });
}

/**
 * Ends the session of the password login (NextAuth). With Convex the browser calls `/api/auth` instead, which Convex Auth
 * handles itself. A request from another site is refused so that a page elsewhere cannot sign the owner out.
 */
export async function POST(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if (loginProvider() === 'convex') return Response.json({ error: 'Use /api/auth to sign out of the Convex login.', code: 'wrong_provider' }, { status: 400 });
  await signOut({ redirect: false });
  return Response.json({ ok: true });
}
