import { ConvexError } from 'convex/values';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { SignJWT, importPKCS8 } from 'jose';
import { SocialError } from '../social/errors.mjs';
import { StudioStoreError } from '../studio/store.mjs';
import { SERVICE_AUDIENCE, SERVICE_ISSUER } from './constants.mjs';

/** Typed-less references to the functions in `convex/` (the JS side never imports generated code). */
export const api = anyApi;

const TOKEN_LIFETIME_MS = 5 * 60 * 1000;
const SOCIAL_CODES = new Set(['account_not_found', 'publication_not_found']);

/** Convex address and signing key from the environment, or null when the studio runs on local files. */
export function convexSettings(env = process.env) {
  const url = env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  const key = env.STUDIO_SERVICE_PRIVATE_KEY;
  if (!key) throw new Error('CONVEX_URL is set but STUDIO_SERVICE_PRIVATE_KEY is missing: run `npm run convex:setup`.');
  const privateKey = key.trim().startsWith('-----BEGIN') ? key : Buffer.from(key, 'base64').toString('utf8');
  return { url, privateKey };
}

/** Turns a ConvexError thrown by our functions into the error classes the rest of the studio already handles. */
export function translateError(error) {
  if (!(error instanceof ConvexError)) return error;
  const { code, message } = typeof error.data === 'object' && error.data ? error.data : { code: 'convex_error', message: String(error.data) };
  if (code === 'unauthorized') return new StudioStoreError('Convex a refusé le jeton du serveur : relancez `npm run convex:setup` pour synchroniser la clé.', 500, 'convex_unauthorized');
  const status = code.endsWith('_not_found') ? 404 : 400;
  return SOCIAL_CODES.has(code) ? new SocialError(message, status, code) : new StudioStoreError(message, status, code);
}

/**
 * Authenticated access to the studio's Convex deployment. The server signs a short-lived token that
 * only this deployment's configured key can validate; every Convex function checks it.
 */
export class ConvexService {
  constructor({ url, privateKey, now = Date.now, fetchImpl = fetch }) {
    this.client = new ConvexHttpClient(url, { logger: false });
    this.privateKey = privateKey;
    this.now = now;
    this.fetch = fetchImpl;
    this.tokenExpiresAt = 0;
  }

  async authenticate() {
    if (this.now() < this.tokenExpiresAt - 60 * 1000) return;
    this.keyObject ??= await importPKCS8(this.privateKey, 'RS256');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'studio-service' })
      .setIssuer(SERVICE_ISSUER)
      .setAudience(SERVICE_AUDIENCE)
      .setSubject('studio-server')
      .setIssuedAt()
      .setExpirationTime(Math.floor((this.now() + TOKEN_LIFETIME_MS) / 1000))
      .sign(this.keyObject);
    this.client.setAuth(token);
    this.tokenExpiresAt = this.now() + TOKEN_LIFETIME_MS;
  }

  async query(reference, args = {}) {
    await this.authenticate();
    try { return await this.client.query(reference, args); } catch (error) { throw translateError(error); }
  }

  async mutation(reference, args = {}) {
    await this.authenticate();
    try { return await this.client.mutation(reference, args); } catch (error) { throw translateError(error); }
  }

  /** Uploads bytes to Convex file storage and returns the storage id. */
  async upload(bytes, mediaType) {
    const uploadUrl = await this.mutation(api.library.generateUploadUrl, {});
    const response = await this.fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': mediaType || 'application/octet-stream' }, body: bytes });
    if (!response.ok) throw new StudioStoreError(`Échec de l’envoi du fichier vers Convex (${response.status})`, 502, 'upload_failed');
    return (await response.json()).storageId;
  }

  async download(url) {
    const response = await this.fetch(url);
    if (!response.ok) throw new StudioStoreError('Media not found', 404, 'media_not_found');
    return Buffer.from(await response.arrayBuffer());
  }
}

let shared = null;
export function getConvexService(env = process.env) {
  const settings = convexSettings(env);
  if (!settings) return null;
  shared ??= new ConvexService(settings);
  return shared;
}
