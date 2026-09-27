import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { extensionFor, slugify, timestampStamp } from '../gateway/media-files.mjs';

export const ELEMENT_KINDS = ['character', 'avatar', 'place', 'object', 'product', 'style'];
export const GENERATION_KINDS = ['image', 'video', 'speech', 'talking'];

const voiceSchema = z.object({
  model: z.string().trim().min(1).max(120).optional(),
  voice: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().max(1000).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  speed: z.number().min(0.25).max(4).optional(),
}).partial();

export const workspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600).default(''),
  settings: z.object({
    aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional(),
    imageModel: z.string().trim().max(120).optional(),
    videoModel: z.string().trim().max(120).optional(),
    speechModel: z.string().trim().max(120).optional(),
    mode: z.enum(['economy', 'balanced', 'quality']).optional(),
    styleNotes: z.string().trim().max(1500).optional(),
  }).partial().default({}),
});

export const elementInputSchema = z.object({
  kind: z.enum(ELEMENT_KINDS),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(3000).default(''),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  voice: voiceSchema.optional(),
});

/** Resolves the on-disk root of the studio library (`STUDIO_DATA_DIR`, default `./data`). */
export function resolveDataDir(env = process.env, cwd = process.cwd()) {
  return path.resolve(cwd, env.STUDIO_DATA_DIR || 'data');
}

export function mediaUrl(workspaceId, file) {
  return `/api/studio/workspaces/${workspaceId}/media/${encodeURIComponent(file)}`;
}

export function toDataUrl(buffer, mediaType) {
  return `data:${mediaType};base64,${Buffer.from(buffer).toString('base64')}`;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) return null;
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return { mediaType: match[1], bytes };
}

const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,180}$/i;

export class StudioStoreError extends Error {
  constructor(message, status = 400, code = 'store_error') {
    super(message);
    this.name = 'StudioStoreError';
    this.status = status;
    this.code = code;
  }
}

/**
 * File-backed library shared by the web app and the MCP server.
 * Every workspace owns a folder with JSON indexes and a media directory.
 */
export class StudioStore {
  constructor({ rootDir, now = () => new Date(), idFactory = randomUUID } = {}) {
    this.rootDir = path.resolve(rootDir || resolveDataDir());
    this.now = now;
    this.idFactory = idFactory;
    this.locks = new Map();
  }

  // ---------------------------------------------------------------- low level

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

  async readJson(file, fallback) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async writeJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, file);
  }

  workspacesFile() {
    return path.join(this.rootDir, 'workspaces.json');
  }

  workspaceDir(workspaceId) {
    if (!SAFE_FILE.test(workspaceId)) throw new StudioStoreError('Invalid workspace id', 400, 'invalid_id');
    return path.join(this.rootDir, 'workspaces', workspaceId);
  }

  mediaDir(workspaceId) {
    return path.join(this.workspaceDir(workspaceId), 'media');
  }

  mediaPath(workspaceId, file) {
    if (!SAFE_FILE.test(file) || file.includes('..')) throw new StudioStoreError('Invalid media file name', 400, 'invalid_file');
    return path.join(this.mediaDir(workspaceId), file);
  }

  // --------------------------------------------------------------- workspaces

  async listWorkspaces() {
    const data = await this.readJson(this.workspacesFile(), { workspaces: [] });
    return data.workspaces.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async getWorkspace(workspaceId) {
    const workspace = (await this.listWorkspaces()).find((item) => item.id === workspaceId);
    if (!workspace) throw new StudioStoreError('Workspace not found', 404, 'workspace_not_found');
    return workspace;
  }

  async createWorkspace(rawInput) {
    const input = workspaceInputSchema.parse(rawInput);
    const timestamp = this.now().toISOString();
    const workspace = { id: this.idFactory(), ...input, createdAt: timestamp, updatedAt: timestamp };
    await this.withLock('workspaces', async () => {
      const data = await this.readJson(this.workspacesFile(), { workspaces: [] });
      data.workspaces.push(workspace);
      await this.writeJson(this.workspacesFile(), data);
    });
    await mkdir(this.mediaDir(workspace.id), { recursive: true });
    return workspace;
  }

  async updateWorkspace(workspaceId, rawPatch) {
    const patch = workspaceInputSchema.partial().parse(rawPatch);
    return this.withLock('workspaces', async () => {
      const data = await this.readJson(this.workspacesFile(), { workspaces: [] });
      const workspace = data.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) throw new StudioStoreError('Workspace not found', 404, 'workspace_not_found');
      Object.assign(workspace, patch, { settings: { ...workspace.settings, ...(patch.settings || {}) }, updatedAt: this.now().toISOString() });
      await this.writeJson(this.workspacesFile(), data);
      return workspace;
    });
  }

  async touchWorkspace(workspaceId) {
    await this.withLock('workspaces', async () => {
      const data = await this.readJson(this.workspacesFile(), { workspaces: [] });
      const workspace = data.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) return;
      workspace.updatedAt = this.now().toISOString();
      await this.writeJson(this.workspacesFile(), data);
    });
  }

  async deleteWorkspace(workspaceId) {
    await this.withLock('workspaces', async () => {
      const data = await this.readJson(this.workspacesFile(), { workspaces: [] });
      const index = data.workspaces.findIndex((item) => item.id === workspaceId);
      if (index === -1) throw new StudioStoreError('Workspace not found', 404, 'workspace_not_found');
      data.workspaces.splice(index, 1);
      await this.writeJson(this.workspacesFile(), data);
    });
    await rm(this.workspaceDir(workspaceId), { recursive: true, force: true });
  }

  /** Returns the first workspace, creating a default one when the library is empty. */
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
    await mkdir(this.mediaDir(workspaceId), { recursive: true });
    await writeFile(this.mediaPath(workspaceId, file), buffer);
    return { id: this.idFactory(), file, mediaType: type, bytes: buffer.length, url: mediaUrl(workspaceId, file), createdAt: this.now().toISOString() };
  }

  async readMedia(workspaceId, file) {
    const filePath = this.mediaPath(workspaceId, file);
    try {
      const [buffer, info] = await Promise.all([readFile(filePath), stat(filePath)]);
      return { buffer, size: info.size, mediaType: mediaTypeFromFile(file) };
    } catch (error) {
      if (error.code === 'ENOENT') throw new StudioStoreError('Media not found', 404, 'media_not_found');
      throw error;
    }
  }

  async mediaAsDataUrl(workspaceId, file) {
    const { buffer, mediaType } = await this.readMedia(workspaceId, file);
    return toDataUrl(buffer, mediaType);
  }

  async removeMedia(workspaceId, file) {
    await rm(this.mediaPath(workspaceId, file), { force: true });
  }

  // ----------------------------------------------------------------- elements

  elementsFile(workspaceId) {
    return path.join(this.workspaceDir(workspaceId), 'elements.json');
  }

  decorateElement(workspaceId, element) {
    return {
      ...element,
      images: (element.images || []).map((image) => ({ ...image, url: mediaUrl(workspaceId, image.file) })),
    };
  }

  async listElements(workspaceId, { kind } = {}) {
    await this.getWorkspace(workspaceId);
    const elements = await this.readJson(this.elementsFile(workspaceId), []);
    return elements
      .filter((element) => !kind || element.kind === kind)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((element) => this.decorateElement(workspaceId, element));
  }

  async getElement(workspaceId, elementId) {
    const element = (await this.listElements(workspaceId)).find((item) => item.id === elementId);
    if (!element) throw new StudioStoreError('Element not found', 404, 'element_not_found');
    return element;
  }

  async findElementsByName(workspaceId, names) {
    const wanted = new Set(names.map((name) => slugify(name)));
    return (await this.listElements(workspaceId)).filter((element) => wanted.has(slugify(element.name)));
  }

  async createElement(workspaceId, rawInput, { images = [] } = {}) {
    const input = elementInputSchema.parse(rawInput);
    await this.getWorkspace(workspaceId);
    const timestamp = this.now().toISOString();
    const element = { id: this.idFactory(), ...input, images: [], createdAt: timestamp, updatedAt: timestamp };
    for (const image of images) element.images.push(await this.storeElementImage(workspaceId, element, image));
    await this.withLock(`elements:${workspaceId}`, async () => {
      const elements = await this.readJson(this.elementsFile(workspaceId), []);
      elements.push(element);
      await this.writeJson(this.elementsFile(workspaceId), elements);
    });
    await this.touchWorkspace(workspaceId);
    return this.decorateElement(workspaceId, element);
  }

  async storeElementImage(workspaceId, element, image) {
    const saved = await this.saveMedia(workspaceId, {
      dataUrl: image.dataUrl,
      bytes: image.bytes,
      mediaType: image.mediaType,
      modality: 'image',
      label: `element-${element.name}`,
    });
    return { id: saved.id, file: saved.file, mediaType: saved.mediaType, bytes: saved.bytes, source: image.source || 'upload', createdAt: saved.createdAt };
  }

  async updateElement(workspaceId, elementId, rawPatch, { addImages = [], removeImageIds = [], primaryImageId } = {}) {
    const patch = elementInputSchema.partial().parse(rawPatch || {});
    const timestamp = this.now().toISOString();
    const result = await this.withLock(`elements:${workspaceId}`, async () => {
      const elements = await this.readJson(this.elementsFile(workspaceId), []);
      const element = elements.find((item) => item.id === elementId);
      if (!element) throw new StudioStoreError('Element not found', 404, 'element_not_found');
      Object.assign(element, patch);
      if (patch.voice) element.voice = { ...(element.voice || {}), ...patch.voice };
      const removed = element.images.filter((image) => removeImageIds.includes(image.id));
      element.images = element.images.filter((image) => !removeImageIds.includes(image.id));
      for (const image of addImages) element.images.push(await this.storeElementImage(workspaceId, element, image));
      if (primaryImageId) {
        const index = element.images.findIndex((image) => image.id === primaryImageId);
        if (index > 0) element.images.unshift(...element.images.splice(index, 1));
      }
      element.updatedAt = timestamp;
      await this.writeJson(this.elementsFile(workspaceId), elements);
      return { element, removed };
    });
    for (const image of result.removed) await this.removeMedia(workspaceId, image.file);
    await this.touchWorkspace(workspaceId);
    return this.decorateElement(workspaceId, result.element);
  }

  async deleteElement(workspaceId, elementId) {
    const removed = await this.withLock(`elements:${workspaceId}`, async () => {
      const elements = await this.readJson(this.elementsFile(workspaceId), []);
      const index = elements.findIndex((item) => item.id === elementId);
      if (index === -1) throw new StudioStoreError('Element not found', 404, 'element_not_found');
      const [element] = elements.splice(index, 1);
      await this.writeJson(this.elementsFile(workspaceId), elements);
      return element;
    });
    for (const image of removed.images || []) await this.removeMedia(workspaceId, image.file);
    await this.touchWorkspace(workspaceId);
  }

  // -------------------------------------------------------------- generations

  generationsFile(workspaceId) {
    return path.join(this.workspaceDir(workspaceId), 'generations.json');
  }

  decorateGeneration(workspaceId, generation) {
    return {
      ...generation,
      files: (generation.files || []).map((file) => ({ ...file, url: mediaUrl(workspaceId, file.file) })),
    };
  }

  async listGenerations(workspaceId, { kind, limit = 200 } = {}) {
    await this.getWorkspace(workspaceId);
    const generations = await this.readJson(this.generationsFile(workspaceId), []);
    return generations
      .filter((generation) => !kind || generation.kind === kind)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map((generation) => this.decorateGeneration(workspaceId, generation));
  }

  async getGeneration(workspaceId, generationId) {
    const generation = (await this.listGenerations(workspaceId, { limit: Number.MAX_SAFE_INTEGER })).find((item) => item.id === generationId);
    if (!generation) throw new StudioStoreError('Generation not found', 404, 'generation_not_found');
    return generation;
  }

  /**
   * Persists generated media plus its metadata. `media` items carry `mediaType` and `base64`
   * (or `uint8Array`); `role` defaults to `output` and lets a talking video keep its voice track.
   */
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
    const generation = {
      id: this.idFactory(),
      kind,
      modality,
      prompt,
      resolvedPrompt: resolvedPrompt || prompt,
      model: model ? { id: model.id, name: model.name, provider: model.provider } : null,
      estimate: estimate || null,
      warnings,
      params,
      elementIds,
      parentId,
      files,
      favorite: false,
      durationMs,
      createdAt: this.now().toISOString(),
    };
    await this.withLock(`generations:${workspaceId}`, async () => {
      const generations = await this.readJson(this.generationsFile(workspaceId), []);
      generations.push(generation);
      await this.writeJson(this.generationsFile(workspaceId), generations);
    });
    await this.touchWorkspace(workspaceId);
    return this.decorateGeneration(workspaceId, generation);
  }

  async updateGeneration(workspaceId, generationId, patch) {
    const allowed = z.object({ favorite: z.boolean().optional(), title: z.string().trim().max(120).optional() }).parse(patch || {});
    const generation = await this.withLock(`generations:${workspaceId}`, async () => {
      const generations = await this.readJson(this.generationsFile(workspaceId), []);
      const item = generations.find((entry) => entry.id === generationId);
      if (!item) throw new StudioStoreError('Generation not found', 404, 'generation_not_found');
      Object.assign(item, allowed);
      await this.writeJson(this.generationsFile(workspaceId), generations);
      return item;
    });
    return this.decorateGeneration(workspaceId, generation);
  }

  async deleteGeneration(workspaceId, generationId) {
    const removed = await this.withLock(`generations:${workspaceId}`, async () => {
      const generations = await this.readJson(this.generationsFile(workspaceId), []);
      const index = generations.findIndex((entry) => entry.id === generationId);
      if (index === -1) throw new StudioStoreError('Generation not found', 404, 'generation_not_found');
      const [generation] = generations.splice(index, 1);
      await this.writeJson(this.generationsFile(workspaceId), generations);
      return generation;
    });
    for (const file of removed.files || []) await this.removeMedia(workspaceId, file.file);
  }

  async workspaceSummary(workspaceId) {
    const [workspace, elements, generations] = await Promise.all([
      this.getWorkspace(workspaceId),
      this.listElements(workspaceId),
      this.listGenerations(workspaceId, { limit: Number.MAX_SAFE_INTEGER }),
    ]);
    const spent = generations.reduce((total, item) => total + (item.estimate?.amount || 0), 0);
    return {
      ...workspace,
      counts: {
        elements: elements.length,
        generations: generations.length,
        images: generations.filter((item) => item.kind === 'image').length,
        videos: generations.filter((item) => item.kind === 'video' || item.kind === 'talking').length,
      },
      estimatedSpendUsd: Math.round(spent * 1000) / 1000,
    };
  }
}

function mediaTypeFromFile(file) {
  const extension = file.split('.').pop().toLowerCase();
  const table = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus', weba: 'audio/webm' };
  return table[extension] || 'application/octet-stream';
}

let sharedStore = null;

/** Process-wide store used by API routes; tests build their own instances. */
export function getStudioStore() {
  if (!sharedStore) sharedStore = new StudioStore({ rootDir: resolveDataDir() });
  return sharedStore;
}
