import { mediaSecret, verifyMediaToken } from '@/lib/studio/public-media.mjs';
import { StudioStoreError, getStudioStore } from '@/lib/studio/store.mjs';

export const dynamic = 'force-dynamic';

/** Unauthenticated, token-protected media endpoint used as `url` input by video providers. */
export async function GET(request, context) {
  const { token, workspaceId, file } = await context.params;
  if (!verifyMediaToken(token, workspaceId, file, mediaSecret())) return new Response('Forbidden', { status: 403 });
  try {
    const { buffer, mediaType, size } = await getStudioStore().readMedia(workspaceId, file);
    return new Response(buffer, { headers: { 'Content-Type': mediaType, 'Content-Length': String(size), 'Cache-Control': 'public, max-age=3600' } });
  } catch (error) {
    if (error instanceof StudioStoreError) return new Response('Not found', { status: 404 });
    throw error;
  }
}
