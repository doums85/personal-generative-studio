/** Where to send the visitor after signing in: only a path of this site (never another host), the studio by default. */
export function safeCallbackPath(value, fallback = '/studio') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || /[\r\n]/.test(value)) return fallback;
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/api/')) return fallback;
  return value;
}
