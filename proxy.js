import { NextResponse } from 'next/server';
import { convexAuthNextjsMiddleware } from '@convex-dev/auth/nextjs/server';
import { auth } from '@/auth';
import { isAllowedSession, isLocalPreview, isPublicPath } from '@/lib/access-control.mjs';
import { ownerFromToken } from '@/lib/server/convex-owner.mjs';
import { loginProvider } from '@/lib/server/login-provider.mjs';
import { getLocaleFromPathname } from './lib/locales';

function addSecurityHeaders(response) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https://ai-gateway.vercel.sh https://*.vercel-storage.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
  );
  return response;
}

/** The access rules, the same whichever system signed the visitor in. */
function guard(request, isSignedInOwner) {
  const { pathname } = request.nextUrl;
  const previewEnabled = isLocalPreview({
    enabled: process.env.LOCAL_PREVIEW,
    nodeEnv: process.env.NODE_ENV,
    hostname: request.nextUrl.hostname,
  });
  const isOwner = previewEnabled || isSignedInOwner;

  if (!isPublicPath(pathname) && !isOwner) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`);
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (pathname === '/login' && isOwner) {
    return addSecurityHeaders(NextResponse.redirect(new URL('/studio', request.url)));
  }

  const response = NextResponse.next();
  response.headers.set('x-locale', getLocaleFromPathname(pathname));
  return addSecurityHeaders(response);
}

const THIRTY_DAYS = 30 * 24 * 60 * 60;

// Convex Auth answers the sign-in/sign-out calls on /api/auth itself, keeps its session cookies fresh, then lets `guard` decide.
const withConvexLogin = convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => guard(request, Boolean(await ownerFromToken(await convexAuth.getToken()))),
  {
    convexUrl: process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
    cookieConfig: { maxAge: THIRTY_DAYS },
    // Only passwords are used: a `?code=` in the URL is never a sign-in code (the Meta and TikTok callbacks carry one).
    shouldHandleCode: false,
  },
);

const withPasswordLogin = auth((request) => guard(request, isAllowedSession(request.auth)));

export default loginProvider() === 'convex' ? withConvexLogin : withPasswordLogin;

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|__nextjs_original-stack-frame).*)',
  ],
};
