import { z } from 'zod';
import { acceptsReferenceImages, maxReferenceImages } from '../gateway/catalog.mjs';
import { GenerationError, loadGatewayCatalog, planGeneration, runGeneration } from '../gateway/engine.mjs';
import { composePrompt } from './prompt.mjs';
import { prepareInputs, parseStudioRef } from './inputs.mjs';
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

/**
 * Generates media inside a workspace: resolves elements and stored references, plans and
 * runs the generation, then records the result in the workspace gallery.
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
  const { elementIds, referenceImages: _ignored, startImage: _s, endImage: _e, referenceAudio: _a, useStyleNotes: _u, parentId, ...engineInput } = input;
  const preliminary = planGeneration(resolvedCatalog, { ...engineInput, prompt: composed.text, referenceImages: [] }, maxCostUsd === undefined ? {} : { maxCostUsd });
  const model = preliminary.model;
  const elementReferences = input.modality === 'audio' ? [] : composed.referenceFiles.map((image) => `studio://${workspaceId}/${encodeURIComponent(image.file)}`);
  const wantedReferences = trimReferences(model, [...elementReferences, ...input.referenceImages], warnings);
  const isVideo = input.modality === 'video';
  const prepared = isVideo
    ? await prepareInputs({ store, workspaceId, model, publicMedia, startImage: input.startImage, endImage: input.endImage, referenceImages: wantedReferences, referenceAudio: input.referenceAudio })
    : { referenceImages: await Promise.all(wantedReferences.map((reference) => resolveReference(store, workspaceId, reference))) };
  const references = prepared.referenceImages;
  const startImage = prepared.startImage;
  const endImage = prepared.endImage;
  const referenceAudio = prepared.referenceAudio;
  const plan = planGeneration(resolvedCatalog, {
    ...engineInput,
    prompt: composed.text,
    referenceImages: references,
    startImage,
    endImage,
    referenceAudio,
  }, maxCostUsd === undefined ? {} : { maxCostUsd });

  const startedAt = now();
  const result = await runGeneration(plan, { generators, tags: ['surface:studio', `workspace:${workspaceId}`, ...tags] });
  const kind = input.modality === 'audio' ? 'speech' : input.modality;
  const generation = await store.createGeneration(workspaceId, {
    kind,
    modality: input.modality,
    prompt: input.prompt,
    resolvedPrompt: composed.text,
    model: result.model,
    estimate: result.estimate,
    warnings: [...warnings, ...(result.warnings || [])],
    params: {
      mode: plan.input.mode,
      aspectRatio: plan.input.aspectRatio,
      size: plan.input.size,
      resolution: plan.input.resolutionLabel || plan.input.resolution,
      duration: plan.input.duration,
      seed: plan.input.seed,
      count: plan.input.count,
      generateAudio: plan.input.generateAudio,
      voice: plan.input.voice,
      language: plan.input.language,
      referenceCount: references.length,
      startImage: Boolean(startImage),
      endImage: Boolean(endImage),
      referenceAudio: Boolean(referenceAudio),
    },
    elementIds: composed.elementIds,
    media: result.media,
    parentId: parentId || null,
    durationMs: now() - startedAt,
  });
  return generation;
}

/** Estimates a workspace generation without calling any provider. */
export async function estimateInWorkspace({ store, workspaceId, request, catalog, loadCatalog = loadGatewayCatalog, maxCostUsd }) {
  const input = studioGenerationSchema.parse(request);
  const workspace = await store.getWorkspace(workspaceId);
  const elements = await store.listElements(workspaceId);
  const composed = composePrompt({ prompt: input.prompt, elements, selectedIds: input.elementIds, styleNotes: input.useStyleNotes ? workspace.settings?.styleNotes : '' });
  const resolvedCatalog = catalog || await loadCatalog();
  const { elementIds, referenceImages, startImage, endImage, referenceAudio, useStyleNotes, parentId, ...engineInput } = input;
  const plan = planGeneration(resolvedCatalog, { ...engineInput, prompt: composed.text }, { maxCostUsd: maxCostUsd === undefined ? null : maxCostUsd });
  const warnings = [];
  const wanted = composed.referenceFiles.length + referenceImages.length;
  if (input.modality !== 'audio' && wanted) trimReferences(plan.model, new Array(wanted).fill('x'), warnings);
  return { model: plan.model, estimate: plan.estimate, resolvedPrompt: composed.text, elements: composed.elements.map((element) => ({ id: element.id, name: element.name, kind: element.kind })), warnings };
}

export function describeError(error) {
  if (error instanceof GenerationError) return { status: error.status, body: { error: error.message, code: error.code, details: error.details } };
  if (error instanceof StudioStoreError) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof z.ZodError) return { status: 400, body: { error: 'Invalid request', code: 'invalid_request', details: error.flatten() } };
  return { status: 500, body: { error: error instanceof Error ? error.message : 'Unexpected error', code: 'internal_error' } };
}
