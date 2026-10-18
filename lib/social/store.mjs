import path from 'node:path';
import { decryptJson, encryptJson, socialSecret } from './crypto.mjs';
import { SocialError } from './errors.mjs';
import { ConvexSocialStore } from '../convex/social-store.mjs';
import { getStudioStore } from '../studio/backend.mjs';

export const PUBLICATION_STATUSES = ['scheduled', 'processing', 'published', 'failed'];

const stores = new WeakMap();

/** Process-wide social store bound to the studio library (one set of accounts and publications per workspace). */
export function getSocialStore(studioStore = getStudioStore()) {
  if (!stores.has(studioStore)) stores.set(studioStore, studioStore.backend === 'convex' ? new ConvexSocialStore(studioStore) : new SocialStore(studioStore));
  return stores.get(studioStore);
}

/**
 * Connected social accounts and publication history, stored next to each workspace's
 * media so deleting a project also forgets its accounts. Tokens are encrypted at rest.
 */
export class SocialStore {
  constructor(studio, { env = process.env } = {}) {
    this.studio = studio;
    this.env = env;
  }

  accountsFile(workspaceId) {
    return path.join(this.studio.workspaceDir(workspaceId), 'social-accounts.json');
  }

  publicationsFile(workspaceId) {
    return path.join(this.studio.workspaceDir(workspaceId), 'publications.json');
  }

  // ----------------------------------------------------------------- accounts

  publicAccount(account) {
    const publicFields = { ...account };
    delete publicFields.credentials;
    return publicFields;
  }

  async listAccounts(workspaceId) {
    await this.studio.getWorkspace(workspaceId);
    const accounts = await this.studio.readJson(this.accountsFile(workspaceId), []);
    return accounts.map((account) => this.publicAccount(account)).sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
  }

  async getAccount(workspaceId, accountId) {
    await this.studio.getWorkspace(workspaceId);
    const account = (await this.studio.readJson(this.accountsFile(workspaceId), [])).find((item) => item.id === accountId);
    if (!account) throw new SocialError('Compte introuvable dans ce projet.', 404, 'account_not_found');
    return { account: this.publicAccount(account), credentials: decryptJson(account.credentials, socialSecret(this.env)) };
  }

  /** Adds or refreshes accounts returned by a connector; an account already known keeps its id. */
  async upsertAccounts(workspaceId, drafts) {
    await this.studio.getWorkspace(workspaceId);
    const secret = socialSecret(this.env);
    const timestamp = this.studio.now().toISOString();
    return this.studio.withLock(`social:${workspaceId}`, async () => {
      const accounts = await this.studio.readJson(this.accountsFile(workspaceId), []);
      const saved = drafts.map((draft) => {
        const encrypted = encryptJson(draft.credentials, secret);
        const existing = accounts.find((item) => item.platform === draft.platform && item.externalId === draft.externalId);
        if (existing) {
          Object.assign(existing, { name: draft.name, handle: draft.handle, avatarUrl: draft.avatarUrl, credentials: encrypted, status: 'active', updatedAt: timestamp });
          return existing;
        }
        const account = { id: this.studio.idFactory(), platform: draft.platform, externalId: draft.externalId, name: draft.name, handle: draft.handle || null, avatarUrl: draft.avatarUrl || null, status: 'active', credentials: encrypted, connectedAt: timestamp, updatedAt: timestamp };
        accounts.push(account);
        return account;
      });
      await this.studio.writeJson(this.accountsFile(workspaceId), accounts);
      return saved.map((account) => this.publicAccount(account));
    });
  }

  async updateCredentials(workspaceId, accountId, credentials) {
    const secret = socialSecret(this.env);
    await this.studio.withLock(`social:${workspaceId}`, async () => {
      const accounts = await this.studio.readJson(this.accountsFile(workspaceId), []);
      const account = accounts.find((item) => item.id === accountId);
      if (!account) return;
      account.credentials = encryptJson(credentials, secret);
      account.status = 'active';
      account.updatedAt = this.studio.now().toISOString();
      await this.studio.writeJson(this.accountsFile(workspaceId), accounts);
    });
  }

  async markNeedsReconnect(workspaceId, accountId) {
    await this.studio.withLock(`social:${workspaceId}`, async () => {
      const accounts = await this.studio.readJson(this.accountsFile(workspaceId), []);
      const account = accounts.find((item) => item.id === accountId);
      if (!account) return;
      account.status = 'needs_reconnect';
      await this.studio.writeJson(this.accountsFile(workspaceId), accounts);
    });
  }

  async removeAccount(workspaceId, accountId) {
    await this.studio.withLock(`social:${workspaceId}`, async () => {
      const accounts = await this.studio.readJson(this.accountsFile(workspaceId), []);
      const index = accounts.findIndex((item) => item.id === accountId);
      if (index === -1) throw new SocialError('Compte introuvable dans ce projet.', 404, 'account_not_found');
      accounts.splice(index, 1);
      await this.studio.writeJson(this.accountsFile(workspaceId), accounts);
    });
  }

  // ------------------------------------------------------------- publications

  async listPublications(workspaceId, { generationId, limit = 100 } = {}) {
    await this.studio.getWorkspace(workspaceId);
    const publications = await this.studio.readJson(this.publicationsFile(workspaceId), []);
    return publications
      .filter((item) => !generationId || item.generationId === generationId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  async getPublication(workspaceId, publicationId) {
    const publication = (await this.listPublications(workspaceId, { limit: Number.MAX_SAFE_INTEGER })).find((item) => item.id === publicationId);
    if (!publication) throw new SocialError('Publication introuvable.', 404, 'publication_not_found');
    return publication;
  }

  async createPublication(workspaceId, fields) {
    const timestamp = this.studio.now().toISOString();
    const publication = { id: this.studio.idFactory(), status: 'processing', state: null, remoteId: null, url: null, draft: false, error: null, ...fields, createdAt: timestamp, updatedAt: timestamp, publishedAt: null };
    // `startedAt` marks when the platform work began: at creation, or at the due time for a scheduled post.
    publication.startedAt = publication.status === 'scheduled' ? null : timestamp;
    await this.studio.withLock(`publications:${workspaceId}`, async () => {
      const publications = await this.studio.readJson(this.publicationsFile(workspaceId), []);
      publications.push(publication);
      await this.studio.writeJson(this.publicationsFile(workspaceId), publications);
    });
    return publication;
  }

  async updatePublication(workspaceId, publicationId, patch) {
    return this.studio.withLock(`publications:${workspaceId}`, async () => {
      const publications = await this.studio.readJson(this.publicationsFile(workspaceId), []);
      const publication = publications.find((item) => item.id === publicationId);
      if (!publication) throw new SocialError('Publication introuvable.', 404, 'publication_not_found');
      Object.assign(publication, patch, { updatedAt: this.studio.now().toISOString() });
      if (patch.status === 'published' && !publication.publishedAt) publication.publishedAt = publication.updatedAt;
      await this.studio.writeJson(this.publicationsFile(workspaceId), publications);
      return publication;
    });
  }

  /** Moves a due scheduled publication to `processing`; returns null when someone else already took it. */
  async claimScheduled(workspaceId, publicationId, nowMs) {
    return this.studio.withLock(`publications:${workspaceId}`, async () => {
      const publications = await this.studio.readJson(this.publicationsFile(workspaceId), []);
      const publication = publications.find((item) => item.id === publicationId);
      if (!publication || publication.status !== 'scheduled' || Date.parse(publication.scheduledAt) > nowMs) return null;
      Object.assign(publication, { status: 'processing', error: null, startedAt: new Date(nowMs).toISOString(), updatedAt: this.studio.now().toISOString() });
      await this.studio.writeJson(this.publicationsFile(workspaceId), publications);
      return publication;
    });
  }

  async deletePublication(workspaceId, publicationId) {
    await this.studio.withLock(`publications:${workspaceId}`, async () => {
      const publications = await this.studio.readJson(this.publicationsFile(workspaceId), []);
      const index = publications.findIndex((item) => item.id === publicationId);
      if (index === -1) throw new SocialError('Publication introuvable.', 404, 'publication_not_found');
      publications.splice(index, 1);
      await this.studio.writeJson(this.publicationsFile(workspaceId), publications);
    });
  }
}
