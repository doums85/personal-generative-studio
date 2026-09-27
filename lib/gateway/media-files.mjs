import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/opus': 'opus',
  'audio/webm': 'weba',
};

const FALLBACK_EXTENSION = { image: 'png', video: 'mp4', audio: 'mp3' };

export const MEDIA_TYPE_BY_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mediaType, extension]) => [extension, mediaType]),
);

export function extensionFor(mediaType, modality) {
  const normalized = String(mediaType || '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[normalized] || FALLBACK_EXTENSION[modality] || 'bin';
}

export function slugify(text, maxLength = 40) {
  const slug = String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'media';
}

export function timestampStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function buildMediaBaseName({ modality, prompt, now = new Date() }) {
  return `${timestampStamp(now)}-${modality}-${slugify(prompt)}`;
}

/**
 * Writes every generated media file (and one JSON manifest) into `outputDir`.
 * `media` items must expose `mediaType` and either `base64` or `uint8Array`.
 */
export async function saveGeneratedMedia({ outputDir, modality, prompt, media, manifest = {}, now = new Date() }) {
  const directory = path.resolve(outputDir);
  await mkdir(directory, { recursive: true });
  const baseName = buildMediaBaseName({ modality, prompt, now });

  const files = [];
  for (const [index, item] of media.entries()) {
    const suffix = media.length > 1 ? `-${index + 1}` : '';
    const filePath = path.join(directory, `${baseName}${suffix}.${extensionFor(item.mediaType, modality)}`);
    const bytes = item.uint8Array ? Buffer.from(item.uint8Array) : Buffer.from(item.base64 || '', 'base64');
    await writeFile(filePath, bytes);
    files.push({ path: filePath, mediaType: item.mediaType, bytes: bytes.length });
  }

  const manifestPath = path.join(directory, `${baseName}.json`);
  await writeFile(manifestPath, `${JSON.stringify({ createdAt: now.toISOString(), modality, prompt, ...manifest, files }, null, 2)}\n`);
  return { files, manifestPath };
}
