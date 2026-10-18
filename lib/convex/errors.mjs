import { ConvexError } from 'convex/values';
import { SocialError } from '../social/errors.mjs';
import { StudioStoreError } from '../studio/errors.mjs';

const SOCIAL_CODES = new Set(['account_not_found', 'publication_not_found']);

/**
 * Turns a ConvexError thrown by our functions into the error classes the rest of the studio already handles.
 * Functions that run publishing code can set `kind` and `status` themselves; otherwise the code decides.
 */
export function translateError(error) {
  if (!(error instanceof ConvexError)) return error;
  const data = typeof error.data === 'object' && error.data ? error.data : { code: 'convex_error', message: String(error.data) };
  const { code, message } = data;
  if (code === 'unauthorized') return new StudioStoreError('Convex a refusé le jeton du serveur : relancez `npm run convex:setup` pour synchroniser la clé.', 500, 'convex_unauthorized');
  const status = Number.isInteger(data.status) ? data.status : code.endsWith('_not_found') ? 404 : 400;
  if (data.kind === 'social' || SOCIAL_CODES.has(code)) return new SocialError(message, status, code, data.details);
  return new StudioStoreError(message, status, code);
}
