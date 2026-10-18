export function parseAllowedEmails(value = '') {
  return new Set(
    value.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
  );
}

export function isAllowedEmail(email, value = process.env.ALLOWED_EMAILS) {
  if (!email) return false;
  const allowedEmails = parseAllowedEmails(value);
  return allowedEmails.size > 0 && allowedEmails.has(email.trim().toLowerCase());
}

export function isAllowedSession(session, value = process.env.ALLOWED_EMAILS) {
  return isAllowedEmail(session?.user?.email, value);
}

export function isLocalPreview({ enabled, nodeEnv, hostname }) {
  if (enabled !== 'true' || nodeEnv === 'production') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

/**
 * Paths reachable without an owner session because they authenticate themselves:
 * /api/mcp with MCP_AUTH_TOKEN (remote MCP clients have no owner session), the scheduler endpoint with
 * CRON_SECRET, and the signed media links (HMAC token in the path) that video providers, Instagram and
 * TikTok download from. The legal pages and TikTok's domain-verification file (`/tiktok<code>.txt`) are public
 * because the networks' reviewers and crawlers read them without a session.
 */
export function isPublicPath(pathname) {
  return pathname === '/login'
    || pathname === '/terms'
    || pathname === '/privacy'
    || /^\/tiktok[A-Za-z0-9]+\.txt$/.test(pathname)
    || pathname.startsWith('/api/auth/')
    || pathname === '/api/mcp'
    || pathname.startsWith('/api/mcp/')
    || pathname === '/api/studio/social/run-due'
    || pathname.startsWith('/api/studio/public/');
}
