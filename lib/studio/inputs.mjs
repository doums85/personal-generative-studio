import { GenerationError } from '../gateway/engine.mjs';
import { publicMediaUrl } from './public-media.mjs';

const STUDIO_REF = /^studio:\/\/([^/]+)\/([^/]+)$/;

export function parseStudioRef(reference) {
  const match = String(reference || '').match(STUDIO_REF);
  return match ? { workspaceId: match[1], file: decodeURIComponent(match[2]) } : null;
}

function acceptsInline(sources = []) {
  return sources.includes('base64') || sources.includes('buffer');
}

/**
 * Prepares one media input for a video model. Providers that only accept `url` inputs get a
 * signed public link (the file is stored in the workspace first when it was inline); everyone
 * else receives a data URL. Throws before any paid call when a public URL is required but not configured.
 */
export async function prepareInput({ store, workspaceId, reference, kind, model, publicMedia, label = 'input' }) {
  if (!reference) return undefined;
  const limit = model?.features?.inputs?.[kind];
  const sources = limit?.sources || [];
  const requiresUrl = model?.modality === 'video' && limit && sources.length > 0 && !acceptsInline(sources);
  const studio = parseStudioRef(reference);
  if (studio && studio.workspaceId !== workspaceId) throw new GenerationError('Reference belongs to another workspace', { status: 403, code: 'foreign_reference' });
  if (/^https?:\/\//.test(reference)) return reference;

  if (!requiresUrl) {
    return studio ? store.mediaAsDataUrl(workspaceId, studio.file) : reference;
  }
  if (!publicMedia) {
    throw new GenerationError(`${model.name} lit ses entrées ${kind === 'audio' ? 'audio' : 'image'} via une URL publique. Définissez STUDIO_PUBLIC_URL (adresse publique de l’application) et AUTH_SECRET, ou choisissez un modèle acceptant les fichiers en base64.`, { status: 422, code: 'public_url_required', details: { model: model.id, kind, sources } });
  }
  if (studio) return publicMediaUrl(publicMedia, workspaceId, studio.file);
  const saved = await store.saveMedia(workspaceId, { dataUrl: reference, modality: kind, label });
  return publicMediaUrl(publicMedia, workspaceId, saved.file);
}

export async function prepareInputs({ store, workspaceId, model, publicMedia, startImage, endImage, referenceImages = [], referenceAudio }) {
  const common = { store, workspaceId, model, publicMedia };
  return {
    startImage: await prepareInput({ ...common, reference: startImage, kind: 'image', label: 'start-frame' }),
    endImage: await prepareInput({ ...common, reference: endImage, kind: 'image', label: 'end-frame' }),
    referenceImages: await Promise.all(referenceImages.map((reference, index) => prepareInput({ ...common, reference, kind: 'image', label: `reference-${index + 1}` }))),
    referenceAudio: await prepareInput({ ...common, reference: referenceAudio, kind: 'audio', label: 'voice-track' }),
  };
}
