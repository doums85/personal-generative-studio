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
