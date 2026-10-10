import { comparableUnitPrice, lowestKnownPrice } from './pricing.mjs';

const MODALITY_BY_TYPE = {
  language: 'language',
  image: 'image',
  video: 'video',
  speech: 'audio',
  transcription: 'audio',
  realtime: 'audio',
};

/**
 * Image models known to accept reference images (image-to-image, editing, character
 * continuity). The Gateway catalog does not publish image capabilities yet, so this list
 * is matched against the model id. Every other image model is treated as text-only.
 */
const IMAGE_REFERENCE_PATTERNS = [
  /^openai\/gpt-image/,
  /^bfl\/flux-kontext/,
  /^bfl\/flux-2-/,
  /^bfl\/flux-pro-1\.0-fill/,
  /^bytedance\/seedream-(4|5)/,
  /^spacexai\/grok-imagine-image/,
  /^meta\/muse-image/,
];

const IMAGE_REFERENCE_LIMITS = [
  [/^openai\/gpt-image/, 16],
  [/^bytedance\/seedream/, 10],
  [/^bfl\/flux-2-/, 8],
  [/^spacexai\/grok-imagine-image/, 5],
];

function imageCapabilities(model) {
  const supportsReferences = IMAGE_REFERENCE_PATTERNS.some((pattern) => pattern.test(model.id));
  const limit = IMAGE_REFERENCE_LIMITS.find(([pattern]) => pattern.test(model.id))?.[1] ?? 3;
  return {
    operations: supportsReferences ? ['text-to-image', 'image-to-image'] : ['text-to-image'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    inputs: supportsReferences ? { image: { maxCount: limit } } : {},
  };
}

function inputLimit(limit) {
  if (!limit || typeof limit !== 'object') return null;
  return {
    maxCount: Number.isFinite(Number(limit.max_count)) ? Number(limit.max_count) : 1,
    sources: Array.isArray(limit.supported_sources) ? limit.supported_sources : [],
    formats: Array.isArray(limit.supported_formats) ? limit.supported_formats : [],
    minSeconds: Number.isFinite(Number(limit.min_duration_seconds)) ? Number(limit.min_duration_seconds) : null,
    maxSeconds: Number.isFinite(Number(limit.max_duration_seconds)) ? Number(limit.max_duration_seconds) : null,
  };
}

function videoCapabilities(model) {
  const raw = model.video_capabilities || {};
  const limits = raw.input_limits || {};
  const inputs = {};
  for (const key of ['image', 'video', 'audio']) {
    const limit = inputLimit(limits[key]);
    if (limit) inputs[key] = limit;
  }
  return {
    operations: Array.isArray(raw.supported_operations) ? raw.supported_operations : [],
    resolutions: Array.isArray(raw.supported_resolutions) ? raw.supported_resolutions : [],
    aspectRatios: Array.isArray(raw.supported_aspect_ratios) ? raw.supported_aspect_ratios : [],
    durations: Array.isArray(raw.supported_durations_seconds) ? raw.supported_durations_seconds : [],
    generateAudio: raw.generate_audio === true,
    inputs,
  };
}

function speechCapabilities() {
  return { operations: ['text-to-speech'], inputs: {} };
}

export function normalizeGatewayModel(model) {
  const modality = MODALITY_BY_TYPE[model.type] || 'language';
  const base = {
    id: model.id,
    name: model.name || model.id,
    description: model.description || '',
    modality,
    operation: model.type || 'language',
    provider: model.owned_by || model.id?.split('/')[0] || 'unknown',
    pricing: model.pricing || {},
    lowestKnownPrice: lowestKnownPrice(model.pricing),
    comparableUnitPrice: comparableUnitPrice(modality, model.pricing),
    capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
    releasedAt: model.created ? new Date(model.created * 1000).toISOString() : null,
  };
  if (modality === 'image') base.features = imageCapabilities(base);
  else if (modality === 'video') base.features = videoCapabilities(model);
  else if (model.type === 'speech') base.features = speechCapabilities();
  else base.features = { operations: [], inputs: {} };
  return base;
}

export function normalizeGatewayCatalog(payload) {
  const source = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(source)) return [];
  return source
    .filter((model) => typeof model?.id === 'string' && model.id.includes('/'))
    .map(normalizeGatewayModel)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupModelsByModality(models) {
  return models.reduce((groups, model) => {
    groups[model.modality] ??= [];
    groups[model.modality].push(model);
    return groups;
  }, { language: [], image: [], video: [], audio: [] });
}

/** True when the model accepts at least one reference image (image editing or reference-to-video). */
export function acceptsReferenceImages(model) {
  return Boolean(model?.features?.inputs?.image);
}

/** True when the model accepts an audio track as input (voice-synchronized video). */
export function acceptsReferenceAudio(model) {
  return Boolean(model?.features?.inputs?.audio);
}

/** True when the video model can render its own soundtrack (native dialogue, ambience). */
export function generatesNativeAudio(model) {
  return model?.features?.generateAudio === true;
}

export function maxReferenceImages(model) {
  return model?.features?.inputs?.image?.maxCount ?? 0;
}

/** Maps Gateway resolution labels (720p, 1080p, 4k…) to pixel dimensions for a given aspect ratio. */
export function resolutionToDimensions(label, aspectRatio = '16:9') {
  const heights = { '360p': 360, '480p': 480, '720p': 720, '768p': 768, hd: 720, fhd: 1080, '1080p': 1080, '2k': 1440, '4k': 2160, '2160p': 2160 };
  const height = heights[String(label || '').toLowerCase()];
  if (!height) return null;
  const [w, h] = String(aspectRatio).split(':').map(Number);
  if (!w || !h) return `${Math.round((height * 16) / 9)}x${height}`;
  if (w >= h) return `${Math.round((height * w) / h / 2) * 2}x${height}`;
  return `${height}x${Math.round((height * h) / w / 2) * 2}`;
}
