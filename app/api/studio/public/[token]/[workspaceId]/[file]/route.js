import { mediaSecret, verifyMediaToken } from '@/lib/studio/public-media.mjs';
import { StudioStoreError, getStudioStore } from '@/lib/studio/store.mjs';

export const dynamic = 'force-dynamic';

/** Re-encodes an image as JPEG: Instagram and TikTok refuse PNG, and WebP is not accepted everywhere. */
async function toJpeg(buffer) {
  const { default: sharp } = await import('sharp');
  return sharp(buffer).rotate().flatten({ background: '#ffffff' }).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}

/** Unauthenticated, token-protected media endpoint used as `url` input by video providers and social networks. */
export async function GET(request, context) {
  const { token, workspaceId, file } = await context.params;
  if (!verifyMediaToken(token, workspaceId, file, mediaSecret())) return new Response('Forbidden', { status: 403 });
  try {
    let { buffer, mediaType, size } = await getStudioStore().readMedia(workspaceId, file);
    if (new URL(request.url).searchParams.get('format') === 'jpeg' && mediaType.startsWith('image/') && mediaType !== 'image/jpeg') {
      buffer = await toJpeg(buffer);
      mediaType = 'image/jpeg';
      size = buffer.length;
    }
    return new Response(buffer, { headers: { 'Content-Type': mediaType, 'Content-Length': String(size), 'Cache-Control': 'public, max-age=3600' } });
  } catch (error) {
    if (error instanceof StudioStoreError) return new Response('Not found', { status: 404 });
    throw error;
  }
}
