'use client';

export const KIND_META = {
  character: { label: 'Personnage', plural: 'Personnages', icon: 'user', hint: 'Une personne dont le visage et la silhouette doivent rester identiques.', ratio: '3:4' },
  avatar: { label: 'Avatar', plural: 'Avatars', icon: 'mic', hint: 'Un présentateur avec une voix : il peut parler face caméra.', ratio: '3:4' },
  place: { label: 'Lieu', plural: 'Lieux', icon: 'map', hint: 'Un décor récurrent : appartement, plage, boutique…', ratio: '16:9' },
  object: { label: 'Objet', plural: 'Objets', icon: 'box', hint: 'Un accessoire ou un véhicule à retrouver d’une scène à l’autre.', ratio: '1:1' },
  product: { label: 'Produit', plural: 'Produits', icon: 'tag', hint: 'Un produit à mettre en scène sans le déformer.', ratio: '1:1' },
  style: { label: 'Style visuel', plural: 'Styles visuels', icon: 'palette', hint: 'Une direction artistique : palette, grain, lumière.', ratio: '1:1' },
  other: { label: 'Référence', plural: 'Autres références', icon: 'layers', hint: 'Toute autre image de référence : moodboard, plan, texture, logo…', ratio: '1:1' },
};

export const VOICE_PRESETS = {
  openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  google: ['Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Callirrhoe', 'Autonoe'],
  spacexai: ['Ara', 'Rex', 'Sal', 'Eve', 'Leo'],
};

export const LANGUAGES = [
  ['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['pt', 'Portugais'], ['ar', 'Arabe'], ['wo', 'Wolof'], ['zh', 'Chinois'], ['ja', 'Japonais'],
];

export const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.code = payload?.code;
  }
}

async function call(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(payload?.error || `Requête échouée (${response.status})`, response.status, payload);
  return payload;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body) => call('POST', url, body),
  patch: (url, body) => call('PATCH', url, body),
  delete: (url) => call('DELETE', url),
};

export function workspaceUrl(workspaceId, suffix = '') {
  return `/api/studio/workspaces/${workspaceId}${suffix}`;
}

export function studioRef(workspaceId, file) {
  return `studio://${workspaceId}/${file}`;
}

export function formatUsd(amount) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const digits = amount < 0.01 ? 4 : amount < 1 ? 3 : 2;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(amount);
}

export function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatDate(value) {
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return '';
  }
}

export function formatDurationMs(value) {
  if (!value) return '';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

export function describeWarning(warning) {
  if (!warning) return '';
  if (typeof warning === 'string') return warning;
  const subject = warning.feature || warning.setting;
  const details = warning.details || warning.message;
  return [subject, details].filter(Boolean).join(' : ') || warning.type || JSON.stringify(warning);
}

export function optimizeImageDataUrl(dataUrl, { maxSize = 1600, quality = 0.86 } = {}) {
  return new Promise((resolve, reject) => {
    const source = new window.Image();
    source.onerror = () => reject(new Error('Format d’image non reconnu.'));
    source.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    source.src = dataUrl;
  });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire ce fichier.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

export async function imageFileToDataUrl(file, options) {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (PNG, JPEG, WebP).');
  return optimizeImageDataUrl(await fileToDataUrl(file), options);
}

/** Fetches a stored media file and returns it as an optimized JPEG data URL (for previews reused as references). */
export async function mediaUrlToDataUrl(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return optimizeImageDataUrl(await fileToDataUrl(blob));
}

const HANDOFF_KEY = 'studio:handoff';

/** One-shot state passed between views (e.g. "animate this image" from the gallery). */
export function setHandoff(payload) {
  try { window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(payload)); } catch { /* storage optional */ }
}

export function takeHandoff(view) {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload?.view !== view) return null;
    window.sessionStorage.removeItem(HANDOFF_KEY);
    return payload;
  } catch {
    return null;
  }
}

export function providerOf(modelId = '') {
  return modelId.split('/')[0];
}

export function voiceSuggestions(modelId) {
  return VOICE_PRESETS[providerOf(modelId)] || [];
}

export function modelSupports(model, feature) {
  const features = model?.features || {};
  switch (feature) {
    case 'references': return Boolean(features.inputs?.image);
    case 'audio-reference': return Boolean(features.inputs?.audio);
    case 'native-audio': return features.generateAudio === true;
    case 'start-image': return (features.operations || []).some((op) => ['image-to-video', 'first-last-frame', 'reference-to-video'].includes(op)) || Boolean(features.inputs?.image);
    case 'end-image': return (features.operations || []).includes('first-last-frame');
    default: return false;
  }
}
