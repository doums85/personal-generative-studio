import { studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ request, params, store }) => {
  const { buffer, mediaType, size } = await store.readMedia(params.workspaceId, params.file);
  const download = new URL(request.url).searchParams.get('download') === '1';
  return new Response(buffer, {
    headers: {
      'Content-Type': mediaType,
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ...(download ? { 'Content-Disposition': `attachment; filename="${params.file}"` } : {}),
    },
  });
});
