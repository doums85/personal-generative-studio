import {
  experimental_generateImage as generateImage,
  experimental_generateSpeech as generateSpeech,
  experimental_generateVideo as generateVideo,
} from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import { normalizeGatewayCatalog } from '@/lib/gateway/catalog.mjs';
import { selectModel } from '@/lib/gateway/routing.mjs';
import { requireOwner } from '@/lib/server/require-owner';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  modality: z.enum(['image', 'video', 'audio']),
  prompt: z.string().trim().min(1).max(8000),
  model: z.string().trim().optional(),
  mode: z.enum(['manual', 'economy', 'balanced', 'quality']).default('balanced'),
  aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional(),
  resolution: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
  duration: z.number().int().min(1).max(30).optional(),
  seed: z.number().int().optional(),
  voice: z.string().trim().max(80).default('alloy'),
  referenceImages: z.array(z.string().startsWith('data:image/').max(2_000_000)).max(3).default([]),
});

async function getCatalog() {
  const response = await fetch('https://ai-gateway.vercel.sh/v1/models', {
    next: { revalidate: 900 },
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Gateway catalog unavailable');
  return normalizeGatewayCatalog(await response.json());
}

function encodeMedia(media) {
  const mediaType = media.mediaType || 'application/octet-stream';
  const base64 = media.base64 || Buffer.from(media.uint8Array).toString('base64');
  return { mediaType, dataUrl: `data:${mediaType};base64,${base64}` };
}

export async function POST(request) {
  if (!(await requireOwner())) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid generation request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const input = parsed.data;
    const catalog = await getCatalog();
    const compatibleCatalog = input.modality === 'audio'
      ? catalog.filter((model) => model.operation === 'speech')
      : catalog;
    const chosen = selectModel(compatibleCatalog, {
      modality: input.modality,
      mode: input.mode === 'manual' ? 'balanced' : input.mode,
      requestedModel: input.model,
    });
    if (!chosen) return Response.json({ error: 'No compatible model is currently available' }, { status: 409 });

    if (input.modality === 'image') {
      const result = await generateImage({
        model: chosen.id,
        prompt: input.referenceImages.length ? { text: input.prompt, images: input.referenceImages } : input.prompt,
        aspectRatio: input.aspectRatio,
        seed: input.seed,
        providerOptions: { gateway: { tags: ['app:personal-studio', 'modality:image'] } },
      });
      return Response.json({ model: chosen, media: result.images.map(encodeMedia), warnings: result.warnings });
    }

    if (input.modality === 'video') {
      const result = await generateVideo({
        model: chosen.id,
        prompt: input.referenceImages[0] ? { text: input.prompt, image: input.referenceImages[0] } : input.prompt,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        duration: input.duration,
        providerOptions: { gateway: { tags: ['app:personal-studio', 'modality:video'] } },
      });
      return Response.json({ model: chosen, media: result.videos.map(encodeMedia), warnings: result.warnings });
    }

    const result = await generateSpeech({
      model: gateway.speechModel(chosen.id),
      text: input.prompt,
      voice: input.voice,
      providerOptions: { gateway: { tags: ['app:personal-studio', 'modality:audio'] } },
    });
    return Response.json({ model: chosen, media: [encodeMedia(result.audio)], warnings: result.warnings });
  } catch (error) {
    console.error('[gateway-generation]', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Generation failed. Check the selected model and Gateway configuration.' }, { status: 502 });
  }
}
