import { z } from 'zod';
import { normalizeGatewayCatalog, resolutionToDimensions } from './catalog.mjs';
import { selectModel } from './routing.mjs';
import { estimateGenerationCost } from './estimate.mjs';

export const GATEWAY_CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';

const ratio = z.string().regex(/^\d{1,2}:\d{1,2}$/, 'Expected a ratio such as 16:9');
const dimensions = z.string().regex(/^\d{2,5}x\d{2,5}$/, 'Expected dimensions such as 1024x1024');
const resolutionInput = z.string().regex(/^(\d{2,5}x\d{2,5}|\d{3,4}p|2k|4k|hd|fhd)$/i, 'Expected a resolution such as 1280x720 or 720p');
const imageReference = z.string().refine((value) => value.startsWith('data:image/') || /^https?:\/\//.test(value), 'Expected an image data URL or an https URL').max(12_000_000);
const audioReference = z.string().refine((value) => value.startsWith('data:audio/') || /^https?:\/\//.test(value), 'Expected an audio data URL or an https URL').max(24_000_000);

export const generationRequestSchema = z.object({
  modality: z.enum(['image', 'video', 'audio']),
  prompt: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).optional(),
  mode: z.enum(['manual', 'economy', 'balanced', 'quality']).default('balanced'),
  aspectRatio: ratio.optional(),
  size: dimensions.optional(),
  resolution: resolutionInput.optional(),
  duration: z.number().int().min(1).max(30).optional(),
  seed: z.number().int().optional(),
  count: z.number().int().min(1).max(4).default(1),
  generateAudio: z.boolean().optional(),
  voice: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().max(2000).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  outputFormat: z.string().trim().min(1).max(20).optional(),
  referenceImages: z.array(imageReference).max(16).default([]),
  startImage: imageReference.optional(),
  endImage: imageReference.optional(),
  referenceAudio: audioReference.optional(),
});

export class GenerationError extends Error {
  constructor(message, { status = 400, code = 'invalid_request', details } = {}) {
    super(message);
    this.name = 'GenerationError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readBudget(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function loadGatewayCatalog({ fetchImpl = fetch, fetchOptions = {} } = {}) {
  let response;
  try {
    response = await fetchImpl(GATEWAY_CATALOG_URL, { ...fetchOptions, headers: { Accept: 'application/json', ...(fetchOptions.headers || {}) } });
  } catch (error) {
    throw new GenerationError(`Gateway catalog unreachable: ${error instanceof Error ? error.message : 'network error'}`, { status: 502, code: 'catalog_unavailable' });
  }
  if (!response.ok) throw new GenerationError('Gateway catalog unavailable', { status: 502, code: 'catalog_unavailable' });
  return normalizeGatewayCatalog(await response.json());
}

export function compatibleModels(catalog, modality) {
  return catalog.filter((model) => model.modality === modality && (modality !== 'audio' || model.operation === 'speech'));
}

const DEFAULT_VOICES = [
  [/^openai\//, 'alloy'],
  [/^google\//, 'Kore'],
  [/^spacexai\//, 'Ara'],
];

export function defaultVoiceFor(model) {
  return DEFAULT_VOICES.find(([pattern]) => pattern.test(model?.id || ''))?.[1];
}

/**
 * Validates a raw request, picks the model according to the routing mode and
 * checks the estimated cost against `MAX_GENERATION_COST_USD`. Never calls a provider.
 */
export function planGeneration(catalog, rawInput, { maxCostUsd = readBudget(process.env.MAX_GENERATION_COST_USD) } = {}) {
  const parsed = generationRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new GenerationError('Invalid generation request', { status: 400, code: 'invalid_request', details: parsed.error.flatten() });
  }
  const input = parsed.data;
  if (input.mode === 'manual' && !input.model) {
    throw new GenerationError('Manual mode requires an explicit model id', { status: 400, code: 'model_required' });
  }

  const models = compatibleModels(catalog, input.modality);
  const model = selectModel(models, {
    modality: input.modality,
    mode: input.mode === 'manual' ? 'balanced' : input.mode,
    requestedModel: input.model,
  });
  if (!model) {
    const message = input.model
      ? `Model "${input.model}" is not available for ${input.modality} generation`
      : `No compatible ${input.modality} model is currently available`;
    throw new GenerationError(message, { status: 409, code: 'model_unavailable' });
  }

  if (input.modality === 'audio' && !input.voice) {
    const voice = defaultVoiceFor(model);
    if (voice) input.voice = voice;
  }
  if (input.modality === 'video' && input.resolution && !/^\d+x\d+$/.test(input.resolution)) {
    input.resolutionLabel = input.resolution;
    input.resolution = resolutionToDimensions(input.resolution, input.aspectRatio) || undefined;
  }

  const estimate = estimateGenerationCost(model, { ...input, resolution: input.resolutionLabel || input.resolution });
  if (maxCostUsd !== null && estimate.amount !== null && estimate.amount > maxCostUsd) {
    throw new GenerationError(
      `Estimated cost ${estimate.amount} USD exceeds the MAX_GENERATION_COST_USD limit of ${maxCostUsd} USD`,
      { status: 422, code: 'budget_exceeded', details: { estimate, maxCostUsd } },
    );
  }

  return { input, model, estimate };
}

function encodeMedia(file) {
  const mediaType = file.mediaType || 'application/octet-stream';
  const base64 = file.base64 || Buffer.from(file.uint8Array).toString('base64');
  return { mediaType, base64 };
}

/** Converts a data URL or https URL into the file shape expected by the AI SDK video API. */
export function toReferenceFile(reference) {
  if (/^https?:\/\//.test(reference)) return { type: 'url', url: reference };
  const match = reference.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) throw new GenerationError('Unsupported reference format', { status: 400, code: 'invalid_reference' });
  return { type: 'file', mediaType: match[1], data: match[2] ? match[3] : Buffer.from(decodeURIComponent(match[3])).toString('base64') };
}

/**
 * Image providers that ignore `aspectRatio` and expect an explicit `size`.
 * Each entry lists the long edge (ByteDance) or the exact sizes it accepts (Recraft).
 */
const SIZE_ONLY_PROVIDERS = {
  bytedance: { longEdge: 2048 },
  recraft: { sizes: ['1024x1024', '1365x1024', '1024x1365', '1536x1024', '1024x1536', '1820x1024', '1024x1820', '1024x2048', '2048x1024', '1434x1024', '1024x1434', '1024x1280', '1280x1024', '1024x1707', '1707x1024'] },
};

/** Converts an aspect ratio into pixel dimensions for providers that only accept `size`. */
export function sizeForAspectRatio(model, aspectRatio) {
  const rule = SIZE_ONLY_PROVIDERS[model?.provider] || SIZE_ONLY_PROVIDERS[model?.id?.split('/')[0]];
  if (!rule || !aspectRatio) return undefined;
  const [w, h] = String(aspectRatio).split(':').map(Number);
  if (!w || !h) return undefined;
  const target = w / h;
  if (rule.sizes) {
    return [...rule.sizes].sort((a, b) => {
      const ratio = (value) => { const [x, y] = value.split('x').map(Number); return Math.abs(x / y - target); };
      return ratio(a) - ratio(b);
    })[0];
  }
  const long = rule.longEdge;
  const short = Math.round((long * Math.min(w, h)) / Math.max(w, h) / 16) * 16;
  return w >= h ? `${long}x${short}` : `${short}x${long}`;
}

/** Providers that expect the resolution as a label (720p) inside their provider options rather than pixels. */
const LABEL_RESOLUTION_PROVIDERS = { spacexai: 'xai' };

export function withProviderResolution(model, resolutionLabel, providerOptions = {}) {
  const key = LABEL_RESOLUTION_PROVIDERS[model?.provider];
  if (!key || !resolutionLabel) return providerOptions;
  return { ...providerOptions, [key]: { ...(providerOptions[key] || {}), resolution: resolutionLabel } };
}

async function defaultGenerators() {
  const [ai, { gateway }] = await Promise.all([import('ai'), import('@ai-sdk/gateway')]);
  return {
    async image({ model, prompt, count, size, aspectRatio, seed, referenceImages, providerOptions }) {
      const explicitSize = size || sizeForAspectRatio(model, aspectRatio);
      const result = await ai.generateImage({
        model: gateway.imageModel(model.id),
        prompt: referenceImages.length ? { text: prompt, images: referenceImages } : prompt,
        n: count,
        size: explicitSize,
        aspectRatio: explicitSize ? undefined : aspectRatio,
        seed,
        providerOptions,
      });
      return { media: result.images.map(encodeMedia), warnings: result.warnings };
    },
    async video({ model, prompt, count, aspectRatio, resolution, resolutionLabel, duration, seed, generateAudio, referenceImages, startImage, endImage, referenceAudio, providerOptions }) {
      const options = withProviderResolution(model, resolutionLabel, providerOptions);
      const inputReferences = [...referenceImages.map(toReferenceFile), ...(referenceAudio ? [toReferenceFile(referenceAudio)] : [])];
      const frameImages = startImage && endImage
        ? [{ type: 'first_frame', image: toReferenceFile(startImage) }, { type: 'last_frame', image: toReferenceFile(endImage) }]
        : undefined;
      const result = await ai.experimental_generateVideo({
        model: gateway.videoModel(model.id),
        prompt: startImage && !frameImages ? { text: prompt, image: startImage } : prompt,
        n: count,
        aspectRatio,
        resolution,
        duration,
        seed,
        generateAudio,
        frameImages,
        inputReferences: inputReferences.length ? inputReferences : undefined,
        providerOptions: options,
      });
      return { media: result.videos.map(encodeMedia), warnings: result.warnings };
    },
    async audio({ model, prompt, voice, outputFormat, instructions, speed, language, providerOptions }) {
      const result = await ai.experimental_generateSpeech({
        model: gateway.speechModel(model.id),
        text: prompt,
        voice,
        outputFormat,
        instructions,
        speed,
        language,
        providerOptions,
      });
      return { media: [encodeMedia(result.audio)], warnings: result.warnings };
    },
  };
}

function describeProviderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/AI_GATEWAY_API_KEY|authentication|unauthorized|401/i.test(message)) {
    return new GenerationError('AI Gateway authentication failed. Set AI_GATEWAY_API_KEY to a valid Vercel AI Gateway key.', { status: 502, code: 'gateway_auth', details: { message } });
  }
  return new GenerationError(`Generation failed: ${message}`, { status: 502, code: 'generation_failed', details: { message } });
}

/**
 * Executes a plan produced by `planGeneration`. Returns raw media (base64) so callers
 * decide whether to stream it to a browser or write it to disk.
 */
export async function runGeneration(plan, { generators, tags = [] } = {}) {
  const { input, model, estimate } = plan;
  const resolvedGenerators = generators || await defaultGenerators();
  const generate = resolvedGenerators[input.modality];
  if (typeof generate !== 'function') throw new GenerationError(`No generator for ${input.modality}`, { status: 500, code: 'generator_missing' });

  const providerOptions = { gateway: { tags: ['app:personal-studio', `modality:${input.modality}`, ...tags] } };
  try {
    const { media, warnings = [] } = await generate({ ...input, model, providerOptions });
    return { model, estimate, media, warnings };
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw describeProviderError(error);
  }
}

export async function generate(rawInput, { catalog, loadCatalog = loadGatewayCatalog, generators, tags, maxCostUsd } = {}) {
  const resolvedCatalog = catalog || await loadCatalog();
  const plan = planGeneration(resolvedCatalog, rawInput, maxCostUsd === undefined ? {} : { maxCostUsd });
  return runGeneration(plan, { generators, tags });
}
