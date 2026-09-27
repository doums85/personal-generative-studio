import { z } from 'zod';
import { acceptsReferenceImages, maxReferenceImages } from '../gateway/catalog.mjs';
import { GenerationError, loadGatewayCatalog, planGeneration, runGeneration } from '../gateway/engine.mjs';
import { composePrompt } from './prompt.mjs';
import { prepareInput, prepareInputs, parseStudioRef } from './inputs.mjs';
import { chooseVideoModelForSpeech, estimateSpeechSeconds, pickVideoDuration, speechRequestSchema, synthesizeSpeech, withSpeechPrompt } from './speech.mjs';
import { StudioStoreError } from './store.mjs';

export const studioGenerationSchema = z.object({
  modality: z.enum(['image', 'video', 'audio']),
  prompt: z.string().trim().min(1).max(8000),
  model: z.string().trim().min(1).optional(),
  mode: z.enum(['manual', 'economy', 'balanced', 'quality']).optional(),
  aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional(),
  size: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
  resolution: z.string().max(12).optional(),
  duration: z.number().int().min(1).max(30).optional(),
  seed: z.number().int().optional(),
  count: z.number().int().min(1).max(4).optional(),
  generateAudio: z.boolean().optional(),
  voice: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().max(2000).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  outputFormat: z.string().trim().min(1).max(20).optional(),
  elementIds: z.array(z.string()).max(12).default([]),
  referenceImages: z.array(z.string()).max(16).default([]),
  startImage: z.string().optional(),
  endImage: z.string().optional(),
  referenceAudio: z.string().optional(),
  speech: speechRequestSchema.optional(),
  useStyleNotes: z.boolean().default(true),
  parentId: z.string().optional(),
});

/** Resolves `studio://<workspace>/<file>` references into data URLs, leaving data and https URLs untouched. */
export async function resolveReference(store, workspaceId, reference) {
  if (!reference) return reference;
  const studio = parseStudioRef(reference);
  if (!studio) return reference;
  if (studio.workspaceId !== workspaceId) throw new StudioStoreError('Reference belongs to another workspace', 403, 'foreign_reference');
  return store.mediaAsDataUrl(workspaceId, studio.file);
}

export function trimReferences(model, references, warnings) {
  if (!references.length) return references;
  if (!acceptsReferenceImages(model)) {
    warnings.push({ type: 'unsupported', feature: 'referenceImages', details: `${model.id} n’accepte pas d’images de référence ; la description textuelle des éléments est conservée.` });
    return [];
  }
  const limit = maxReferenceImages(model) || references.length;
  if (references.length > limit) {
    warnings.push({ type: 'other', message: `${model.id} accepte ${limit} image(s) de référence ; ${references.length - limit} image(s) ignorée(s).` });
    return references.slice(0, limit);
  }
  return references;
}

function budgetOptions(maxCostUsd) {
  return maxCostUsd === undefined ? {} : { maxCostUsd };
}

/** Finds who speaks: the explicit speaker, else the first composed element that carries a voice or a face. */
function resolveSpeaker(elements, composed, speakerId) {
  if (speakerId) {
    const speaker = elements.find((element) => element.id === speakerId);
    if (!speaker) throw new StudioStoreError('Speaker element not found', 404, 'element_not_found');
    return speaker;
  }
  return composed.elements.find((element) => element.voice?.voice || element.voice?.model) || composed.elements.find((element) => ['avatar', 'character'].includes(element.kind)) || null;
}

/**
 * Generates media inside a workspace: resolves elements and stored references, plans and
 * runs the generation, then records the result in the workspace gallery. A video request can
 * carry `speech`: the dialogue is synthesized and fed to a lip-syncing model (or spoken natively).
 */
export async function generateInWorkspace({ store, workspaceId, request, catalog, loadCatalog = loadGatewayCatalog, generators, tags = [], maxCostUsd, publicMedia = null, now = () => Date.now() }) {
  const input = studioGenerationSchema.parse(request);
  const workspace = await store.getWorkspace(workspaceId);
  const elements = await store.listElements(workspaceId);
  const composed = composePrompt({
    prompt: input.prompt,
    elements,
    selectedIds: input.elementIds,
    styleNotes: input.useStyleNotes && input.modality !== 'audio' ? workspace.settings?.styleNotes : '',
  });

  const resolvedCatalog = catalog || await loadCatalog();
  const warnings = [];
  const isVideo = input.modality === 'video';
  const speech = isVideo && input.speech ? input.speech : null;
  const { elementIds, referenceImages: _ignored, startImage: _s, endImage: _e, referenceAudio: _a, speech: _sp, useStyleNotes: _u, parentId, ...engineInput } = input;
  const startedAt = now();
  const budget = budgetOptions(maxCostUsd);

  // 1. Model choice: dialogue narrows the catalog to models that can carry the voice.
  let model;
  let speaker = null;
  let startImageRef = input.startImage;
  if (speech) {
    speaker = resolveSpeaker(elements, composed, speech.speakerId);
    if (!startImageRef && speaker?.images?.length) startImageRef = `studio://${workspaceId}/${encodeURIComponent(speaker.images[0].file)}`;
    model = chooseVideoModelForSpeech(resolvedCatalog, { mode: speech.mode, requested: input.model, videoMode: input.mode === 'manual' ? 'balanced' : input.mode || 'balanced', needsStartImage: Boolean(startImageRef) });
  } else {
    model = planGeneration(resolvedCatalog, { ...engineInput, prompt: composed.text, referenceImages: [] }, budget).model;
  }

  // 2. Dialogue: check the script length, synthesize the voice and derive the clip duration.
  let prompt = composed.text;
  let referenceAudio = input.referenceAudio;
  let generateAudio = input.generateAudio;
  let duration = input.duration;
  const media = [];
  let speechResult = null;
  if (speech) {
    const audioLimit = model.features?.inputs?.audio?.maxSeconds;
    const assertScriptFits = (seconds) => {
      if (speech.mode === 'reference' && audioLimit && seconds > audioLimit) {
        throw new GenerationError(`Le texte dure environ ${Math.round(seconds)} s, au-delà des ${audioLimit} s acceptés par ${model.name}. Raccourcissez le dialogue ou découpez-le en plusieurs plans.`, { status: 422, code: 'script_too_long', details: { speechSeconds: seconds, audioLimit } });
      }
    };
    let seconds = estimateSpeechSeconds(speech.script);
    assertScriptFits(seconds);
    prompt = withSpeechPrompt(composed.text, { script: speech.script, language: speech.language, mode: speech.mode, speakerName: speaker?.name });
    if (speech.mode === 'reference') {
      const audioSources = model.features?.inputs?.audio?.sources || [];
      if (audioSources.length && !audioSources.includes('base64') && !publicMedia) {
        throw new GenerationError(`${model.name} lit la piste audio via une URL publique. Définissez STUDIO_PUBLIC_URL (adresse publique de l’application) et AUTH_SECRET, ou choisissez la méthode « voix native ».`, { status: 422, code: 'public_url_required', details: { model: model.id, sources: audioSources } });
      }
      speechResult = await synthesizeSpeech({ catalog: resolvedCatalog, script: speech.script, speech, voice: speaker?.voice || {}, generators, maxCostUsd, tags: ['surface:studio', `workspace:${workspaceId}`, ...tags] });
      seconds = speechResult.seconds;
      assertScriptFits(seconds);
      warnings.push(...speechResult.warnings);
      const saved = await store.saveMedia(workspaceId, { bytes: speechResult.bytes, mediaType: speechResult.mediaType, modality: 'audio', label: `voice-${speaker?.name || 'dialogue'}` });
      media.push({ saved, role: 'audio' });
      referenceAudio = `studio://${workspaceId}/${encodeURIComponent(saved.file)}`;
    } else {
      generateAudio = true;
    }
    duration = pickVideoDuration(model, seconds, input.duration);
    speechResult = { ...(speechResult || {}), seconds };
  }

  // 3. References: element images first, then manual ones, trimmed to the model's limits and hosted when required.
  const elementReferences = input.modality === 'audio' ? [] : composed.referenceFiles.map((image) => `studio://${workspaceId}/${encodeURIComponent(image.file)}`);
  const wantedReferences = trimReferences(model, [...elementReferences, ...input.referenceImages], warnings);
  const prepared = isVideo
    ? await prepareInputs({ store, workspaceId, model, publicMedia, startImage: startImageRef, endImage: input.endImage, referenceImages: wantedReferences, referenceAudio })
    : { referenceImages: await Promise.all(wantedReferences.map((reference) => resolveReference(store, workspaceId, reference))) };

  // 4. Plan (budget check) and run.
  const plan = planGeneration(resolvedCatalog, {
    ...engineInput,
    model: model.id,
    mode: 'manual',
    prompt,
    duration,
    generateAudio,
    referenceImages: prepared.referenceImages,
    startImage: prepared.startImage,
    endImage: prepared.endImage,
    referenceAudio: prepared.referenceAudio,
  }, budget);
  const result = await runGeneration(plan, { generators, tags: ['surface:studio', `workspace:${workspaceId}`, ...tags] });
  media.unshift(...result.media.map((item) => ({ ...item, role: 'output' })));

  const estimate = speechResult?.estimate
    ? { amount: result.estimate.amount === null && speechResult.estimate.amount == null ? null : (result.estimate.amount ?? 0) + (speechResult.estimate.amount ?? 0), currency: 'USD', basis: [result.estimate.basis, speechResult.estimate.basis].filter(Boolean).join(' + '), assumed: Boolean(result.estimate.assumed || speechResult.estimate.assumed) }
    : result.estimate;

  const kind = input.modality === 'audio' ? 'speech' : input.modality;
  return store.createGeneration(workspaceId, {
    kind,
    modality: input.modality,
    prompt: input.prompt,
    resolvedPrompt: prompt,
    model: result.model,
    estimate,
    warnings: [...warnings, ...(result.warnings || [])],
    params: {
      mode: input.mode || 'balanced',
      aspectRatio: plan.input.aspectRatio,
      size: plan.input.size,
      resolution: plan.input.resolutionLabel || plan.input.resolution,
      duration: plan.input.duration,
      seed: plan.input.seed,
      count: plan.input.count,
      generateAudio: plan.input.generateAudio,
      voice: plan.input.voice,
      language: plan.input.language,
      referenceCount: prepared.referenceImages.length,
      startImage: Boolean(prepared.startImage),
      endImage: Boolean(prepared.endImage),
      referenceAudio: Boolean(prepared.referenceAudio),
      speech: speech ? {
        mode: speech.mode,
        script: speech.script,
        language: speech.language,
        speaker: speaker ? { id: speaker.id, name: speaker.name } : null,
        seconds: speechResult?.seconds ?? null,
        voice: speech.mode === 'native' ? null : (speechResult?.voice || speech.voice || speaker?.voice?.voice || null),
        speechModel: speechResult?.model ? { id: speechResult.model.id, name: speechResult.model.name } : null,
      } : null,
    },
    elementIds: speaker && !composed.elementIds.includes(speaker.id) ? [...composed.elementIds, speaker.id] : composed.elementIds,
    media,
    parentId: parentId || null,
    durationMs: now() - startedAt,
  });
}

/** Estimates a workspace generation without calling any provider (dialogue included). */
export async function estimateInWorkspace({ store, workspaceId, request, catalog, loadCatalog = loadGatewayCatalog, maxCostUsd }) {
  const input = studioGenerationSchema.parse(request);
  const workspace = await store.getWorkspace(workspaceId);
  const elements = await store.listElements(workspaceId);
  const composed = composePrompt({ prompt: input.prompt, elements, selectedIds: input.elementIds, styleNotes: input.useStyleNotes ? workspace.settings?.styleNotes : '' });
  const resolvedCatalog = catalog || await loadCatalog();
  const { elementIds, referenceImages, startImage, endImage, referenceAudio, speech, useStyleNotes, parentId, ...engineInput } = input;
  const warnings = [];
  const budget = { maxCostUsd: maxCostUsd === undefined ? null : maxCostUsd };
  const dialogue = input.modality === 'video' && speech ? speech : null;

  let model;
  let duration = input.duration;
  let speechEstimate = null;
  if (dialogue) {
    const speaker = resolveSpeaker(elements, composed, dialogue.speakerId);
    model = chooseVideoModelForSpeech(resolvedCatalog, { mode: dialogue.mode, requested: input.model, videoMode: input.mode === 'manual' ? 'balanced' : input.mode || 'balanced', needsStartImage: Boolean(startImage || speaker?.images?.length) });
    const seconds = estimateSpeechSeconds(dialogue.script);
    duration = pickVideoDuration(model, seconds, input.duration);
    const audioLimit = model.features?.inputs?.audio?.maxSeconds;
    if (dialogue.mode === 'reference' && audioLimit && seconds > audioLimit) warnings.push({ type: 'other', message: `Dialogue ≈ ${Math.round(seconds)} s : au-delà des ${audioLimit} s acceptés par ${model.name}.` });
    if (dialogue.mode === 'reference') {
      const speechModelId = dialogue.speechModel || speaker?.voice?.model;
      const speechPlan = planGeneration(resolvedCatalog, { modality: 'audio', prompt: dialogue.script, model: speechModelId, mode: speechModelId ? 'manual' : 'economy' }, budget);
      speechEstimate = { model: speechPlan.model, estimate: speechPlan.estimate };
    }
  } else {
    model = planGeneration(resolvedCatalog, { ...engineInput, prompt: composed.text }, budget).model;
  }
  const plan = planGeneration(resolvedCatalog, { ...engineInput, model: model.id, mode: 'manual', prompt: composed.text, duration, generateAudio: dialogue?.mode === 'native' ? true : input.generateAudio }, budget);
  const wanted = composed.referenceFiles.length + referenceImages.length;
  if (input.modality !== 'audio' && wanted) trimReferences(plan.model, new Array(wanted).fill('x'), warnings);
  const total = speechEstimate
    ? { amount: plan.estimate.amount === null && speechEstimate.estimate.amount == null ? null : (plan.estimate.amount ?? 0) + (speechEstimate.estimate.amount ?? 0), currency: 'USD', basis: [plan.estimate.basis, speechEstimate.estimate.basis].filter(Boolean).join(' + '), assumed: Boolean(plan.estimate.assumed || speechEstimate.estimate.assumed) }
    : plan.estimate;
  return {
    model: plan.model,
    estimate: total,
    duration: plan.input.duration,
    speechModel: speechEstimate?.model ? { id: speechEstimate.model.id, name: speechEstimate.model.name } : null,
    resolvedPrompt: composed.text,
    elements: composed.elements.map((element) => ({ id: element.id, name: element.name, kind: element.kind })),
    warnings,
  };
}

export function describeError(error) {
  if (error instanceof GenerationError) return { status: error.status, body: { error: error.message, code: error.code, details: error.details } };
  if (error instanceof StudioStoreError) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof z.ZodError) return { status: 400, body: { error: 'Invalid request', code: 'invalid_request', details: error.flatten() } };
  return { status: 500, body: { error: error instanceof Error ? error.message : 'Unexpected error', code: 'internal_error' } };
}
