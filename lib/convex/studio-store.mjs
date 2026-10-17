import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { extensionFor, slugify, timestampStamp } from '../gateway/media-files.mjs';
import {
  GENERATION_KINDS, SAFE_FILE, StudioStoreError, elementInputSchema, mediaTypeFromFile, mediaUrl, parseDataUrl, toDataUrl, workspaceInputSchema,
} from '../studio/store.mjs';
import { api } from './service.mjs';

/** Makes a value safe to send to Convex: plain JSON, no `undefined`, no NaN. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

/**
 * The studio library on Convex: same methods and return shapes as the file-backed `StudioStore`, so the web
 * app, the generation service and the MCP server do not know which one they talk to. Documents live in Convex
 * tables, media bytes in Convex file storage.
 */
export class ConvexStudioStore {
  constructor({ service, now = () => new Date(), idFactory = randomUUID } = {}) {
    this.backend = 'convex';
    this.service = service;
    this.now = now;
    this.idFactory = idFactory;
    this.locks = new Map();
  }

  /** In-process mutual exclusion for read-then-write sequences that span several Convex calls. */
  async withLock(key, action) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.locks.set(key, previous.then(() => current));
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  checkId(workspaceId) {
    if (!SAFE_FILE.test(String(workspaceId))) throw new StudioStoreError('Invalid workspace id', 400, 'invalid_id');
    return workspaceId;
  }

  // --------------------------------------------------------------- workspaces

  async listWorkspaces() {
    return this.service.query(api.library.listWorkspaces, {});
  }

  async getWorkspace(workspaceId) {
    return this.service.query(api.library.getWorkspace, { uid: this.checkId(workspaceId) });
  }

  async createWorkspace(rawInput) {
    const input = workspaceInputSchema.parse(rawInput);
    return this.service.mutation(api.library.createWorkspace, { uid: this.idFactory(), name: input.name, description: input.description, settings: plain(input.settings), createdAt: this.now().toISOString() });
  }

  async updateWorkspace(workspaceId, rawPatch) {
    const patch = workspaceInputSchema.partial().parse(rawPatch);
    return this.service.mutation(api.library.updateWorkspace, { uid: this.checkId(workspaceId), patch: plain(patch), updatedAt: this.now().toISOString() });
  }

  /** Convex mutations bump `updatedAt` themselves; kept so callers of the file store keep working. */
  async touchWorkspace() {}

  async deleteWorkspace(workspaceId) {
    await this.service.mutation(api.library.deleteWorkspace, { uid: this.checkId(workspaceId) });
  }

  async ensureDefaultWorkspace() {
    const existing = await this.listWorkspaces();
    if (existing.length) return existing[existing.length - 1];
    return this.createWorkspace({ name: 'Mon premier projet', description: 'Espace de travail créé automatiquement.' });
  }

  // -------------------------------------------------------------------- media

  async saveMedia(workspaceId, { bytes, dataUrl, mediaType, modality = 'image', label = 'media' }) {
    await this.getWorkspace(workspaceId);
    const parsed = dataUrl ? parseDataUrl(dataUrl) : null;
    if (dataUrl && !parsed) throw new StudioStoreError('Invalid data URL', 400, 'invalid_media');
    const buffer = parsed ? parsed.bytes : Buffer.from(bytes);
    const type = parsed?.mediaType || mediaType || 'application/octet-stream';
    const file = `${timestampStamp(this.now())}-${slugify(label, 32)}-${this.idFactory().slice(0, 8)}.${extensionFor(type, modality)}`;
    const createdAt = this.now().toISOString();
    const storageId = await this.service.upload(buffer, type);
    await this.service.mutation(api.library.registerMedia, { workspaceUid: workspaceId, file, storageId, mediaType: type, bytes: buffer.length, createdAt });
    return { id: this.idFactory(), file, mediaType: type, bytes: buffer.length, url: mediaUrl(workspaceId, file), createdAt };
  }

  async readMedia(workspaceId, file) {
    this.checkId(workspaceId);
    if (!SAFE_FILE.test(file) || file.includes('..')) throw new StudioStoreError('Invalid media file name', 400, 'invalid_file');
    const info = await this.service.query(api.library.getMediaUrl, { workspaceUid: workspaceId, file });
    if (!info) throw new StudioStoreError('Media not found', 404, 'media_not_found');
    const buffer = await this.service.download(info.url);
    const derived = mediaTypeFromFile(file);
    return { buffer, size: buffer.length, mediaType: derived !== 'application/octet-stream' ? derived : info.mediaType };
  }

  async mediaAsDataUrl(workspaceId, file) {
    const { buffer, mediaType } = await this.readMedia(workspaceId, file);
    return toDataUrl(buffer, mediaType);
  }

  async removeMedia(workspaceId, file) {
    await this.service.mutation(api.library.removeMedia, { workspaceUid: this.checkId(workspaceId), file });
  }

  // ----------------------------------------------------------------- elements

  decorateElement(workspaceId, element) {
    return { ...element, images: (element.images || []).map((image) => ({ ...image, url: mediaUrl(workspaceId, image.file) })) };
  }

  async listElements(workspaceId, { kind } = {}) {
    const elements = await this.service.query(api.library.listElements, { workspaceUid: this.checkId(workspaceId), ...(kind ? { kind } : {}) });
    return elements.map((element) => this.decorateElement(workspaceId, element));
  }

  async getElement(workspaceId, elementId) {
    return this.decorateElement(workspaceId, await this.service.query(api.library.getElement, { workspaceUid: this.checkId(workspaceId), uid: elementId }));
  }

  async findElementsByName(workspaceId, names) {
    const wanted = new Set(names.map((name) => slugify(name)));
    return (await this.listElements(workspaceId)).filter((element) => wanted.has(slugify(element.name)));
  }

  async storeElementImage(workspaceId, element, image) {
    const saved = await this.saveMedia(workspaceId, { dataUrl: image.dataUrl, bytes: image.bytes, mediaType: image.mediaType, modality: 'image', label: `element-${element.name}` });
    return { id: saved.id, file: saved.file, mediaType: saved.mediaType, bytes: saved.bytes, source: image.source || 'upload', createdAt: saved.createdAt };
  }

  async createElement(workspaceId, rawInput, { images = [] } = {}) {
    const input = elementInputSchema.parse(rawInput);
    await this.getWorkspace(workspaceId);
    const stored = [];
    for (const image of images) stored.push(await this.storeElementImage(workspaceId, input, image));
    const element = await this.service.mutation(api.library.createElement, {
      workspaceUid: workspaceId, uid: this.idFactory(), kind: input.kind, name: input.name, description: input.description, tags: input.tags,
      ...(input.voice ? { voice: plain(input.voice) } : {}), images: stored, createdAt: this.now().toISOString(),
    });
    return this.decorateElement(workspaceId, element);
  }

  async updateElement(workspaceId, elementId, rawPatch, { addImages = [], removeImageIds = [], primaryImageId } = {}) {
    const patch = elementInputSchema.partial().parse(rawPatch || {});
    const current = await this.service.query(api.library.getElement, { workspaceUid: this.checkId(workspaceId), uid: elementId });
    const stored = [];
    for (const image of addImages) stored.push(await this.storeElementImage(workspaceId, current, image));
    const result = await this.service.mutation(api.library.updateElement, {
      workspaceUid: workspaceId, uid: elementId, patch: plain(patch), addImages: stored, removeImageIds, ...(primaryImageId ? { primaryImageId } : {}), updatedAt: this.now().toISOString(),
    });
    for (const file of result.removedFiles) await this.removeMedia(workspaceId, file);
    return this.decorateElement(workspaceId, result.element);
  }

  async deleteElement(workspaceId, elementId) {
    const files = await this.service.mutation(api.library.deleteElement, { workspaceUid: this.checkId(workspaceId), uid: elementId, updatedAt: this.now().toISOString() });
    for (const file of files) await this.removeMedia(workspaceId, file);
  }

  // -------------------------------------------------------------- generations

  decorateGeneration(workspaceId, generation) {
    return { ...generation, files: (generation.files || []).map((file) => ({ ...file, url: mediaUrl(workspaceId, file.file) })) };
  }

  async listGenerations(workspaceId, { kind, limit = 200 } = {}) {
    const generations = await this.service.query(api.library.listGenerations, { workspaceUid: this.checkId(workspaceId), ...(kind ? { kind } : {}), limit: Math.min(limit, 500) });
    return generations.map((generation) => this.decorateGeneration(workspaceId, generation));
  }

  async getGeneration(workspaceId, generationId) {
    return this.decorateGeneration(workspaceId, await this.service.query(api.library.getGeneration, { workspaceUid: this.checkId(workspaceId), uid: generationId }));
  }

  /** Persists generated media plus its metadata. See StudioStore.createGeneration for the `media` item shape. */
  async createGeneration(workspaceId, { kind, modality, prompt, resolvedPrompt, model, estimate, warnings = [], params = {}, elementIds = [], media = [], parentId = null, durationMs = null }) {
    if (!GENERATION_KINDS.includes(kind)) throw new StudioStoreError('Invalid generation kind', 400, 'invalid_kind');
    await this.getWorkspace(workspaceId);
    const files = [];
    for (const item of media) {
      if (item.saved) {
        files.push({ id: item.saved.id, file: item.saved.file, mediaType: item.saved.mediaType, bytes: item.saved.bytes, role: item.role || 'output' });
        continue;
      }
      const saved = await this.saveMedia(workspaceId, {
        bytes: item.uint8Array ? Buffer.from(item.uint8Array) : Buffer.from(item.base64 || '', 'base64'),
        mediaType: item.mediaType,
        modality: item.modality || modality,
        label: prompt,
      });
      files.push({ id: saved.id, file: saved.file, mediaType: saved.mediaType, bytes: saved.bytes, role: item.role || 'output' });
    }
    const generation = await this.service.mutation(api.library.createGeneration, {
      workspaceUid: workspaceId,
      uid: this.idFactory(),
      kind,
      modality,
      prompt,
      resolvedPrompt: resolvedPrompt || prompt,
      model: model ? plain({ id: model.id, name: model.name, provider: model.provider }) : null,
      estimate: plain(estimate || null),
      warnings: plain(warnings),
      params: plain(params),
      elementIds,
      parentId,
      files,
      favorite: false,
      durationMs,
      createdAt: this.now().toISOString(),
    });
    return this.decorateGeneration(workspaceId, generation);
  }

  async updateGeneration(workspaceId, generationId, patch) {
    const allowed = z.object({ favorite: z.boolean().optional(), title: z.string().trim().max(120).optional() }).parse(patch || {});
    return this.decorateGeneration(workspaceId, await this.service.mutation(api.library.updateGeneration, { workspaceUid: this.checkId(workspaceId), uid: generationId, ...allowed }));
  }

  async deleteGeneration(workspaceId, generationId) {
    const files = await this.service.mutation(api.library.deleteGeneration, { workspaceUid: this.checkId(workspaceId), uid: generationId });
    for (const file of files) await this.removeMedia(workspaceId, file);
  }

  async workspaceSummary(workspaceId) {
    const { spentUsd, ...workspace } = await this.service.query(api.library.workspaceSummary, { uid: this.checkId(workspaceId) });
    return { ...workspace, estimatedSpendUsd: Math.round(spentUsd * 1000) / 1000 };
  }
}
