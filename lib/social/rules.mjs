import { CAPTION_LIMITS, PLATFORM_LABELS } from './platforms.mjs';

export function mediaKindOf(mediaType = '') {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('video/')) return 'video';
  return null;
}

function ratioOf(aspectRatio) {
  const match = String(aspectRatio || '').match(/^(\d{1,2}):(\d{1,2})$/);
  return match && Number(match[2]) ? Number(match[1]) / Number(match[2]) : null;
}

/**
 * Pre-flight checks before sending a creation to a platform.
 * Errors block the publication; warnings are shown but do not.
 */
export function checkPublishable({ platform, kind, aspectRatio, caption = '' }) {
  const name = PLATFORM_LABELS[platform] || platform;
  const issues = [];
  if (!kind) {
    issues.push({ level: 'error', message: `${name} ne publie que des images et des vidéos (pas d’audio seul).` });
    return issues;
  }
  const limit = CAPTION_LIMITS[platform];
  if (limit && caption.length > limit) issues.push({ level: 'error', message: `La légende dépasse ${limit} caractères pour ${name} (${caption.length}).` });

  const ratio = ratioOf(aspectRatio);
  if (platform === 'instagram' && kind === 'image' && ratio && (ratio < 0.8 || ratio > 1.91)) {
    issues.push({ level: 'error', message: `Instagram n’accepte que les images entre 4:5 et 1,91:1 (format ${aspectRatio}). Générez-la en 4:5, 1:1 ou 16:9.` });
  }
  if (kind === 'video' && ratio && ratio > 0.8 && (platform === 'instagram' || platform === 'tiktok')) {
    issues.push({ level: 'warning', message: `${name} affiche les vidéos en 9:16 : le format ${aspectRatio} sera rogné ou entouré de bandes.` });
  }
  if (platform === 'instagram' && caption.split(/\s+/).filter((word) => word.startsWith('#')).length > 30) {
    issues.push({ level: 'error', message: 'Instagram limite à 30 hashtags par publication.' });
  }
  return issues;
}
