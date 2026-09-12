import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAllowedSession, isLocalPreview } from '@/lib/access-control.mjs';
import { getLocaleFromPathname } from './lib/locales';

function addSecurityHeaders(response) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https://ai-gateway.vercel.sh https://*.vercel-storage.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com;",
  );
  return response;
}

function isPublicPath(pathname) {
  return pathname === '/login' || pathname.startsWith('/api/auth/');
}

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const previewEnabled = isLocalPreview({
    enabled: process.env.LOCAL_PREVIEW,
    nodeEnv: process.env.NODE_ENV,
    hostname: request.nextUrl.hostname,
  });
  const isOwner = previewEnabled || isAllowedSession(request.auth);

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
});

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|__nextjs_original-stack-frame).*)',
  ],
};
