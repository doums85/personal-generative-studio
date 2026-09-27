import { studioRoute } from '@/lib/server/studio-api';
import { publicMediaConfig } from '@/lib/studio/public-media.mjs';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async () => {
  const limit = Number(process.env.MAX_GENERATION_COST_USD);
  const publicMedia = publicMediaConfig();
  return Response.json({
    maxCostUsd: Number.isFinite(limit) ? limit : null,
    publicMediaConfigured: Boolean(publicMedia),
    publicBaseUrl: publicMedia?.baseUrl || null,
    dataDir: process.env.STUDIO_DATA_DIR || 'data',
  });
});
