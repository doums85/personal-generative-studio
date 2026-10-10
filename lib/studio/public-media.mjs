import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed public links for workspace media. Video providers that only accept `url` audio or
 * image inputs fetch the file from this link; the token proves the link was issued by us.
 */
export function mediaSecret(env = process.env) {
  return env.STUDIO_MEDIA_SECRET || env.AUTH_SECRET || '';
}

export function publicBaseUrl(env = process.env) {
  const explicit = env.STUDIO_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

export function publicMediaConfig(env = process.env) {
  const baseUrl = publicBaseUrl(env);
  const secret = mediaSecret(env);
  return baseUrl && secret ? { baseUrl, secret } : null;
}

export function signMedia(workspaceId, file, secret) {
  if (!secret) throw new Error('A media secret is required to sign public links');
  return createHmac('sha256', secret).update(`${workspaceId}/${file}`).digest('hex').slice(0, 40);
}

export function verifyMediaToken(token, workspaceId, file, secret) {
  if (!secret || typeof token !== 'string') return false;
  const expected = signMedia(workspaceId, file, secret);
  if (expected.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function publicMediaUrl({ baseUrl, secret }, workspaceId, file) {
  return `${baseUrl}/api/studio/public/${signMedia(workspaceId, file, secret)}/${workspaceId}/${encodeURIComponent(file)}`;
}
