import { decryptJson, encryptJson, socialSecret } from '../social/crypto.mjs';
import { api } from './api.mjs';

/** Social accounts and publications on Convex; tokens are encrypted here, so Convex only ever stores ciphertext. */
export class ConvexSocialStore {
  /**
   * `functions` are the Convex functions to call: the owner-checked public ones (`api.social`, from the web app and
   * the MCP server) or the internal ones (`internal.socialInternal`, from the publishing actions inside Convex).
   * `studio.service` is anything with `query(reference, args)` and `mutation(reference, args)`.
   */
  constructor(studio, { env = process.env, functions = api.social } = {}) {
    this.backend = 'convex';
    this.studio = studio;
    this.service = studio.service;
    this.env = env;
    this.fns = functions;
  }

  // ----------------------------------------------------------------- accounts

  async listAccounts(workspaceId) {
    const accounts = await this.service.query(this.fns.listAccounts, { workspaceUid: workspaceId });
    return accounts.sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
  }

  async getAccount(workspaceId, accountId) {
    const { account, credentials } = await this.service.query(this.fns.getAccount, { workspaceUid: workspaceId, uid: accountId });
    return { account, credentials: decryptJson(credentials, socialSecret(this.env)) };
  }

  /** Adds or refreshes accounts returned by a connector; an account already known keeps its id. */
  async upsertAccounts(workspaceId, drafts) {
    const secret = socialSecret(this.env);
    return this.service.mutation(this.fns.upsertAccounts, {
      workspaceUid: workspaceId,
      now: this.studio.now().toISOString(),
      accounts: drafts.map((draft) => ({
        uid: this.studio.idFactory(),
        platform: draft.platform,
        externalId: draft.externalId,
        name: draft.name,
        handle: draft.handle || null,
        avatarUrl: draft.avatarUrl || null,
        credentials: encryptJson(draft.credentials, secret),
      })),
    });
  }

  async updateCredentials(workspaceId, accountId, credentials) {
    await this.service.mutation(this.fns.updateCredentials, { workspaceUid: workspaceId, uid: accountId, credentials: encryptJson(credentials, socialSecret(this.env)), now: this.studio.now().toISOString() });
  }

  async markNeedsReconnect(workspaceId, accountId) {
    await this.service.mutation(this.fns.markNeedsReconnect, { workspaceUid: workspaceId, uid: accountId });
  }

  async removeAccount(workspaceId, accountId) {
    await this.service.mutation(this.fns.removeAccount, { workspaceUid: workspaceId, uid: accountId });
  }

  // ------------------------------------------------------------- publications

  listPublications(workspaceId, { generationId, limit = 100 } = {}) {
    return this.service.query(this.fns.listPublications, { workspaceUid: workspaceId, ...(generationId ? { generationId } : {}), limit: Math.min(limit, 500) });
  }

  getPublication(workspaceId, publicationId) {
    return this.service.query(this.fns.getPublication, { workspaceUid: workspaceId, uid: publicationId });
  }

  async createPublication(workspaceId, fields) {
    const timestamp = this.studio.now().toISOString();
    const status = fields.status || 'processing';
    return this.service.mutation(this.fns.createPublication, {
      uid: this.studio.idFactory(),
      workspaceUid: workspaceId,
      generationId: fields.generationId,
      fileId: fields.fileId,
      accountId: fields.accountId,
      platform: fields.platform,
      accountName: fields.accountName,
      caption: fields.caption,
      options: JSON.parse(JSON.stringify(fields.options ?? {})),
      media: JSON.parse(JSON.stringify(fields.media ?? null)),
      status,
      state: null,
      remoteId: null,
      url: null,
      draft: false,
      error: null,
      ...(fields.scheduledAt ? { scheduledAt: fields.scheduledAt } : {}),
      // `startedAt` marks when the platform work began: at creation, or at the due time for a scheduled post.
      startedAt: status === 'scheduled' ? null : timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      publishedAt: null,
    });
  }

  async updatePublication(workspaceId, publicationId, patch) {
    const allowed = {};
    for (const key of ['status', 'state', 'remoteId', 'url', 'draft', 'error']) {
      if (patch[key] !== undefined) allowed[key] = key === 'state' ? JSON.parse(JSON.stringify(patch[key])) : patch[key];
    }
    return this.service.mutation(this.fns.updatePublication, { workspaceUid: workspaceId, uid: publicationId, patch: allowed, updatedAt: this.studio.now().toISOString() });
  }

  async deletePublication(workspaceId, publicationId) {
    await this.service.mutation(this.fns.deletePublication, { workspaceUid: workspaceId, uid: publicationId });
  }

  /** Moves a due scheduled publication to `processing`; null when someone else already took it. */
  claimScheduled(workspaceId, publicationId, nowMs) {
    return this.service.mutation(this.fns.claimScheduled, { workspaceUid: workspaceId, uid: publicationId, nowMs, startedAt: new Date(nowMs).toISOString(), updatedAt: this.studio.now().toISOString() });
  }
}
