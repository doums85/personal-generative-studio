import { z } from 'zod';
import { acceptsReferenceAudio, generatesNativeAudio } from '../gateway/catalog.mjs';
import { GenerationError, loadGatewayCatalog, planGeneration, runGeneration } from '../gateway/engine.mjs';
import { toDataUrl } from './store.mjs';
import { prepareInput } from './inputs.mjs';

export const talkingRequestSchema = z.object({
  elementId: z.string().min(1),
  script: z.string().trim().min(1).max(4000),
  mode: z.enum(['reference', 'native']).default('reference'),
  language: z.string().trim().min(2).max(8).default('fr'),
  speechModel: z.string().trim().min(1).optional(),
  voice: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().max(1000).optional(),
  videoModel: z.string().trim().min(1).optional(),
  videoMode: z.enum(['economy', 'balanced', 'quality']).default('balanced'),
  aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).default('9:16'),
  resolution: z.string().max(12).optional(),
  duration: z.number().int().min(1).max(30).optional(),
  scene: z.string().trim().max(1500).default(''),
  seed: z.number().int().optional(),
});

/** Reads the duration of a RIFF/WAVE buffer from its header; returns null for other formats. */
export function wavDurationSeconds(buffer) {
  const bytes = Buffer.from(buffer);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = null;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') byteRate = bytes.readUInt32LE(offset + 16);
    if (chunkId === 'data' && byteRate) {
      // Streaming encoders write 0 or 0xFFFFFFFF as the data size: fall back to the real payload length.
      const remaining = bytes.length - offset - 8;
      const dataSize = chunkSize === 0 || chunkSize > remaining ? remaining : chunkSize;
      return dataSize / byteRate;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

/** Rough spoken duration from text length (about 15 characters per second in French or English). */
export function estimateSpeechSeconds(text, charactersPerSecond = 15) {
  const characters = String(text || '').replace(/\s+/g, ' ').trim().length;
  return Math.max(1, Math.round((characters / charactersPerSecond) * 10) / 10);
}

/** Picks the shortest supported duration that fits `seconds`, or the longest one when the speech is longer. */
export function pickVideoDuration(model, seconds, requested) {
  const supported = model?.features?.durations || [];
  const wanted = Math.max(Number(requested) || 0, Math.ceil(seconds + 0.5));
  if (!supported.length) return Math.min(30, Math.max(1, wanted));
  const fitting = supported.filter((value) => value >= wanted);
  return fitting.length ? Math.min(...fitting) : Math.max(...supported);
}

function languageName(code) {
  return { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', ar: 'Arabic', wo: 'Wolof', zh: 'Mandarin Chinese', ja: 'Japanese' }[code] || code;
}

export function buildTalkingPrompt({ element, script, scene, language, mode }) {
  const identity = element.description?.trim() ? `${element.name}: ${element.description.trim()}.` : `${element.name}.`;
  const setting = scene?.trim() ? ` Setting: ${scene.trim()}.` : ' Neutral, softly lit setting that matches the reference image.';
  const base = `Talking-head video of the exact same person as in the reference image, ${identity}${setting} Medium close-up, the presenter faces the camera, natural head movement, expressive eyes, subtle hand gestures, no camera cuts, no text overlays.`;
  if (mode === 'native') {
    return `${base} They speak clearly in ${languageName(language)} and say exactly: "${script.trim()}". Lip movements perfectly synchronized with the spoken words, natural voice, no background music.`;
  }
  return `${base} The presenter speaks the provided voice track in ${languageName(language)}; lip movements, breathing and pauses are perfectly synchronized with the audio. No additional voice, no background music.`;
}

export function chooseVideoModelForTalking(catalog, { mode, requested, videoMode }) {
  const videos = catalog.filter((model) => model.modality === 'video');
  const eligible = videos.filter((model) => (mode === 'native' ? generatesNativeAudio(model) : acceptsReferenceAudio(model)) && model.features?.inputs?.image);
  if (requested) {
    const model = videos.find((item) => item.id === requested);
    if (!model) throw new GenerationError(`Model "${requested}" is not available for video generation`, { status: 409, code: 'model_unavailable' });
    if (!eligible.includes(model)) {
      throw new GenerationError(mode === 'native'
        ? `${requested} ne génère pas de voix native ; choisissez un modèle avec audio natif ou le mode voix de référence.`
        : `${requested} n’accepte pas de piste audio de référence ; choisissez Seedance 2.0, Wan 2.7, MiniMax H3 ou Grok Imagine 1.5.`, { status: 409, code: 'model_incompatible' });
    }
    return model;
  }
  if (!eligible.length) throw new GenerationError('No video model supports voice-synchronized generation right now', { status: 409, code: 'model_unavailable' });
  const priced = eligible.map((model) => ({ model, price: model.comparableUnitPrice ?? Number.POSITIVE_INFINITY }));
  priced.sort((a, b) => a.price - b.price);
  if (videoMode === 'economy') return priced[0].model;
  if (videoMode === 'quality') return priced[priced.length - 1].model;
  return priced[Math.floor((priced.length - 1) / 2)].model;
}

/**
 * Produces a talking video for an avatar element.
 * `reference` mode synthesizes the script with a speech model and feeds the audio track to a
 * video model that accepts audio references; `native` mode asks a video model with native audio
 * to speak the script itself.
 */
export async function generateTalkingVideo({ store, workspaceId, request, catalog, loadCatalog = loadGatewayCatalog, generators, maxCostUsd, publicMedia = null, now = () => Date.now() }) {
  const input = talkingRequestSchema.parse(request);
  const element = await store.getElement(workspaceId, input.elementId);
  if (!element.images?.length) throw new GenerationError('Cet élément n’a pas d’image de référence : ajoutez un portrait avant de le faire parler.', { status: 400, code: 'element_without_image' });
  const resolvedCatalog = catalog || await loadCatalog();
  const startedAt = now();
  const media = [];
  const warnings = [];
  const budget = maxCostUsd === undefined ? {} : { maxCostUsd };
  let speechEstimate = null;
  let speechModel = null;
  let referenceAudio;
  let speechSeconds = estimateSpeechSeconds(input.script);
  const videoModel = chooseVideoModelForTalking(resolvedCatalog, { mode: input.mode, requested: input.videoModel, videoMode: input.videoMode });
  const audioLimit = videoModel.features?.inputs?.audio?.maxSeconds;
  const assertScriptFits = (seconds) => {
    if (input.mode === 'reference' && audioLimit && seconds > audioLimit) {
      throw new GenerationError(`Le texte dure environ ${Math.round(seconds)} s, au-delà des ${audioLimit} s acceptés par ${videoModel.name}. Raccourcissez le script ou découpez-le en plusieurs plans.`, { status: 422, code: 'script_too_long', details: { speechSeconds: seconds, audioLimit } });
    }
  };
  assertScriptFits(speechSeconds);
  const startImage = await prepareInput({ store, workspaceId, model: videoModel, publicMedia, kind: 'image', reference: `studio://${workspaceId}/${encodeURIComponent(element.images[0].file)}`, label: 'start-frame' });
  const audioSources = videoModel.features?.inputs?.audio?.sources || [];
  const needsPublicUrl = input.mode === 'reference' && audioSources.length > 0 && !audioSources.includes('base64');
  if (needsPublicUrl && !publicMedia) {
    throw new GenerationError(`${videoModel.name} lit la piste audio via une URL publique. Définissez STUDIO_PUBLIC_URL (adresse publique de l’application) et AUTH_SECRET, ou utilisez le mode « voix native du modèle ».`, { status: 422, code: 'public_url_required', details: { model: videoModel.id, sources: audioSources } });
  }

  if (input.mode === 'reference') {
    const voice = { ...(element.voice || {}) };
    const speechPlan = planGeneration(resolvedCatalog, {
      modality: 'audio',
      prompt: input.script,
      model: input.speechModel || voice.model,
      mode: input.speechModel || voice.model ? 'manual' : 'economy',
      voice: input.voice || voice.voice,
      instructions: input.instructions || voice.instructions,
      language: input.language || voice.language,
      speed: voice.speed,
      outputFormat: /^openai\//.test(input.speechModel || voice.model || '') ? 'wav' : undefined,
    }, budget);
    const speech = await runGeneration(speechPlan, { generators, tags: ['surface:studio', 'pipeline:talking', `workspace:${workspaceId}`] });
    const audio = speech.media[0];
    const audioBytes = audio.uint8Array ? Buffer.from(audio.uint8Array) : Buffer.from(audio.base64 || '', 'base64');
    speechSeconds = wavDurationSeconds(audioBytes) ?? speechSeconds;
    speechEstimate = speech.estimate;
    speechModel = speech.model;
    warnings.push(...(speech.warnings || []));
    if (needsPublicUrl) {
      const saved = await store.saveMedia(workspaceId, { bytes: audioBytes, mediaType: audio.mediaType, modality: 'audio', label: `voice-${element.name}` });
      referenceAudio = await prepareInput({ store, workspaceId, model: videoModel, publicMedia, kind: 'audio', reference: `studio://${workspaceId}/${encodeURIComponent(saved.file)}` });
      media.push({ saved, role: 'audio' });
    } else {
      referenceAudio = toDataUrl(audioBytes, audio.mediaType);
      media.push({ ...audio, role: 'audio', modality: 'audio' });
    }
  }

  assertScriptFits(speechSeconds);
  const duration = pickVideoDuration(videoModel, speechSeconds, input.duration);
  const prompt = buildTalkingPrompt({ element, script: input.script, scene: input.scene, language: input.language, mode: input.mode });
  const videoPlan = planGeneration(resolvedCatalog, {
    modality: 'video',
    prompt,
    model: videoModel.id,
    mode: 'manual',
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    duration,
    seed: input.seed,
    generateAudio: input.mode === 'native' ? true : undefined,
    startImage,
    referenceAudio,
  }, budget);
  const video = await runGeneration(videoPlan, { generators, tags: ['surface:studio', 'pipeline:talking', `workspace:${workspaceId}`] });
  media.unshift(...video.media.map((item) => ({ ...item, role: 'output' })));
  warnings.push(...(video.warnings || []));

  const totalEstimate = {
    amount: (video.estimate.amount ?? 0) + (speechEstimate?.amount ?? 0),
    currency: 'USD',
    basis: [video.estimate.basis, speechEstimate?.basis].filter(Boolean).join(' + '),
    assumed: Boolean(video.estimate.assumed || speechEstimate?.assumed),
  };
  if (video.estimate.amount === null && speechEstimate?.amount == null) totalEstimate.amount = null;

  return store.createGeneration(workspaceId, {
    kind: 'talking',
    modality: 'video',
    prompt: input.script,
    resolvedPrompt: prompt,
    model: video.model,
    estimate: totalEstimate,
    warnings,
    params: {
      mode: input.mode,
      language: input.language,
      aspectRatio: input.aspectRatio,
      resolution: videoPlan.input.resolutionLabel || videoPlan.input.resolution,
      duration,
      speechSeconds,
      speechModel: speechModel ? { id: speechModel.id, name: speechModel.name } : null,
      voice: input.voice || element.voice?.voice,
      scene: input.scene,
    },
    elementIds: [element.id],
    media,
    durationMs: now() - startedAt,
  });
}
