import { z } from 'zod';
import { normalizeGatewayCatalog } from './catalog.mjs';
import { selectModel } from './routing.mjs';
import { estimateGenerationCost } from './estimate.mjs';

export const GATEWAY_CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';

const ratio = z.string().regex(/^\d{1,2}:\d{1,2}$/, 'Expected a ratio such as 16:9');
const dimensions = z.string().regex(/^\d{2,5}x\d{2,5}$/, 'Expected dimensions such as 1024x1024');

export const generationRequestSchema = z.object({
  modality: z.enum(['image', 'video', 'audio']),
  prompt: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).optional(),
  mode: z.enum(['manual', 'economy', 'balanced', 'quality']).default('balanced'),
  aspectRatio: ratio.optional(),
  size: dimensions.optional(),
  resolution: dimensions.optional(),
  duration: z.number().int().min(1).max(30).optional(),
  seed: z.number().int().optional(),
  count: z.number().int().min(1).max(4).default(1),
  generateAudio: z.boolean().optional(),
  voice: z.string().trim().min(1).max(80).default('alloy'),
  outputFormat: z.string().trim().min(1).max(20).optional(),
  referenceImages: z.array(z.string().startsWith('data:image/').max(2_000_000)).max(3).default([]),
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

  const estimate = estimateGenerationCost(model, input);
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

async function defaultGenerators() {
  const [ai, { gateway }] = await Promise.all([import('ai'), import('@ai-sdk/gateway')]);
  return {
    async image({ model, prompt, count, size, aspectRatio, seed, referenceImages, providerOptions }) {
      const result = await ai.generateImage({
        model: gateway.imageModel(model.id),
        prompt: referenceImages.length ? { text: prompt, images: referenceImages } : prompt,
        n: count,
        size,
        aspectRatio,
        seed,
        providerOptions,
      });
      return { media: result.images.map(encodeMedia), warnings: result.warnings };
    },
    async video({ model, prompt, count, aspectRatio, resolution, duration, seed, generateAudio, referenceImages, providerOptions }) {
      const result = await ai.experimental_generateVideo({
        model: gateway.videoModel(model.id),
        prompt: referenceImages[0] ? { text: prompt, image: referenceImages[0] } : prompt,
        n: count,
        aspectRatio,
        resolution,
        duration,
        seed,
        generateAudio,
        providerOptions,
      });
      return { media: result.videos.map(encodeMedia), warnings: result.warnings };
    },
    async audio({ model, prompt, voice, outputFormat, providerOptions }) {
      const result = await ai.generateSpeech({
        model: gateway.speechModel(model.id),
        text: prompt,
        voice,
        outputFormat,
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
