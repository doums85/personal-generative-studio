import { z } from 'zod';
import { acceptsReferenceAudio, generatesNativeAudio } from '../gateway/catalog.mjs';
import { GenerationError, planGeneration, runGeneration } from '../gateway/engine.mjs';

/** Dialogue attached to a video generation: the spoken text, who speaks it and how the voice is produced. */
export const speechRequestSchema = z.object({
  script: z.string().trim().min(1).max(4000),
  speakerId: z.string().optional(),
  mode: z.enum(['reference', 'native']).default('reference'),
  language: z.string().trim().min(2).max(8).default('fr'),
  speechModel: z.string().trim().min(1).optional(),
  voice: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().max(1000).optional(),
  speed: z.number().min(0.25).max(4).optional(),
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

export function languageName(code) {
  return { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', ar: 'Arabic', wo: 'Wolof', zh: 'Mandarin Chinese', ja: 'Japanese' }[code] || code;
}

/** True when the video model can carry this dialogue with the requested method. */
export function supportsSpeech(model, mode) {
  return mode === 'native' ? generatesNativeAudio(model) : acceptsReferenceAudio(model);
}

/** Appends the dialogue instructions to a video prompt so lips, breathing and pauses follow the voice. */
export function withSpeechPrompt(prompt, { script, language, mode, speakerName }) {
  const who = speakerName ? `${speakerName}` : 'The speaking character';
  const base = `${prompt.trim()}\n\n${who} speaks to camera with natural head movement and expressive eyes; lip movements, breathing and pauses are perfectly synchronized with the speech. No subtitles, no text overlays, no background music.`;
  if (mode === 'native') {
    return `${base} They speak clearly in ${languageName(language)} and say exactly: "${script.trim()}".`;
  }
  return `${base} The dialogue is the provided voice track, spoken in ${languageName(language)}; do not add any other voice.`;
}

/**
 * Picks a video model able to carry dialogue. `requested` is validated against the method;
 * otherwise the catalog is ranked by price according to `videoMode`.
 */
export function chooseVideoModelForSpeech(catalog, { mode, requested, videoMode = 'balanced', needsStartImage = false }) {
  const videos = catalog.filter((model) => model.modality === 'video');
  const eligible = videos.filter((model) => supportsSpeech(model, mode) && (!needsStartImage || model.features?.inputs?.image));
  if (requested) {
    const model = videos.find((item) => item.id === requested);
    if (!model) throw new GenerationError(`Model "${requested}" is not available for video generation`, { status: 409, code: 'model_unavailable' });
    if (!supportsSpeech(model, mode)) {
      throw new GenerationError(mode === 'native'
        ? `${model.name} ne génère pas de voix native ; choisissez un modèle avec audio natif (Veo 3, Kling 2.6/3.0, Grok Imagine, Seedance 1.5, Wan) ou la méthode « piste audio synchronisée ».`
        : `${model.name} n’accepte pas de piste audio de référence ; choisissez Seedance 2.0, Wan 2.6/2.7/3.0, MiniMax H3 ou Grok Imagine 1.5, ou la méthode « voix native ».`, { status: 409, code: 'model_incompatible' });
    }
    return model;
  }
  if (!eligible.length) throw new GenerationError('No video model supports synchronized dialogue right now', { status: 409, code: 'model_unavailable' });
  const priced = eligible.map((model) => ({ model, price: model.comparableUnitPrice ?? Number.POSITIVE_INFINITY }));
  priced.sort((a, b) => a.price - b.price);
  if (videoMode === 'economy') return priced[0].model;
  if (videoMode === 'quality') return priced[priced.length - 1].model;
  return priced[Math.floor((priced.length - 1) / 2)].model;
}

/** Runs the speech model for a script and returns the audio bytes with their measured duration. */
export async function synthesizeSpeech({ catalog, script, speech, voice = {}, generators, maxCostUsd, tags = [] }) {
  const modelId = speech.speechModel || voice.model;
  const plan = planGeneration(catalog, {
    modality: 'audio',
    prompt: script,
    model: modelId,
    mode: modelId ? 'manual' : 'economy',
    voice: speech.voice || voice.voice,
    instructions: speech.instructions || voice.instructions,
    language: speech.language || voice.language,
    speed: speech.speed ?? voice.speed,
    outputFormat: /^openai\//.test(modelId || '') ? 'wav' : undefined,
  }, maxCostUsd === undefined ? {} : { maxCostUsd });
  const result = await runGeneration(plan, { generators, tags: ['pipeline:speech', ...tags] });
  const audio = result.media[0];
  const bytes = audio.uint8Array ? Buffer.from(audio.uint8Array) : Buffer.from(audio.base64 || '', 'base64');
  return {
    bytes,
    mediaType: audio.mediaType,
    seconds: wavDurationSeconds(bytes) ?? estimateSpeechSeconds(script),
    estimate: result.estimate,
    model: result.model,
    warnings: result.warnings || [],
    voice: plan.input.voice,
  };
}
