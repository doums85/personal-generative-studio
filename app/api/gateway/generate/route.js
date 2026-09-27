import { GenerationError, loadGatewayCatalog, planGeneration, runGeneration } from '@/lib/gateway/engine.mjs';
import { requireOwner } from '@/lib/server/require-owner';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!(await requireOwner())) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);

  try {
    const catalog = await loadGatewayCatalog({ fetchOptions: { next: { revalidate: 900 } } });
    const plan = planGeneration(catalog, body);
    const result = await runGeneration(plan, { tags: ['surface:web'] });
    return Response.json({
      model: result.model,
      estimate: result.estimate,
      media: result.media.map((item) => ({ mediaType: item.mediaType, dataUrl: `data:${item.mediaType};base64,${item.base64}` })),
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof GenerationError) {
      if (error.status >= 500) console.error('[gateway-generation]', error.message);
      return Response.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    console.error('[gateway-generation]', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Generation failed. Check the selected model and Gateway configuration.' }, { status: 502 });
  }
}
