import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { newNonce, signState, socialSecret, verifyState } from './crypto.mjs';
import { SocialError } from './errors.mjs';
import { PLATFORM_LABELS, SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from './platforms.mjs';
import { connectorFor, connectorStatus, getConnector, getPublisher, missingEnv } from './registry.mjs';
import { checkPublishable, mediaKindOf } from './rules.mjs';
import { schedulerStatus } from './schedule.mjs';
import { publicBaseUrl, publicMediaConfig, publicMediaUrl } from '../studio/public-media.mjs';

const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const publishOptionsSchema = z.object({
  mode: z.enum(['publish', 'draft']),
  privacyLevel: z.string().trim().max(40),
  disableComment: z.boolean(),
  disableDuet: z.boolean(),
  disableStitch: z.boolean(),
  shareToFeed: z.boolean(),
}).partial();

export const publishRequestSchema = z.object({
  generationId: z.string().min(1),
  fileId: z.string().min(1).optional(),
  caption: z.string().max(5000).default(''),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  targets: z.array(z.object({
    accountId: z.string().min(1),
    caption: z.string().max(5000).optional(),
    options: publishOptionsSchema.default({}),
  })).min(1).max(10),
});

export function redirectUriFor(connectorId, { env = process.env, requestOrigin } = {}) {
  const base = publicBaseUrl(env) || requestOrigin;
  if (!base) throw new SocialError('Définissez STUDIO_PUBLIC_URL : les réseaux sociaux ont besoin d’une adresse de retour.', 400, 'public_url_required');
  return `${base.replace(/\/+$/, '')}/api/studio/social/callback/${connectorId}`;
}

/** Everything the social screen needs: connectable networks, accounts of this project, setup hints. */
export async function socialOverview({ social, workspaceId, env = process.env, requestOrigin }) {
  const accounts = await social.listAccounts(workspaceId);
  const media = publicMediaConfig(env);
  return {
    connectors: connectorStatus(env).map((connector) => ({ ...connector, redirectUri: redirectUriFor(connector.id, { env, requestOrigin }) })),
    accounts,
    publicMediaConfigured: Boolean(media),
    publicMediaPrefix: media ? `${media.baseUrl}/api/studio/public/` : null,
    scheduler: schedulerStatus(env),
  };
}

// ---------------------------------------------------------------- connection

export async function startConnection({ social, workspaceId, connectorId, env = process.env, requestOrigin }) {
  const connector = getConnector(connectorId);
  const missing = missingEnv(connector, env);
  if (missing.length) throw new SocialError(`${connector.label} n’est pas configuré : renseignez ${missing.join(', ')}.`, 400, 'not_configured');
  await social.studio.getWorkspace(workspaceId);
  const nonce = newNonce();
  const state = signState({ workspaceId, connector: connectorId, nonce }, socialSecret(env));
  const redirectUri = redirectUriFor(connectorId, { env, requestOrigin });
  return { url: connector.authorizeUrl({ env, redirectUri, state }), nonce };
}

function sameSecret(a = '', b = '') {
  return a.length > 0 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function completeConnection({ social, connectorId, code, state, nonce, env = process.env, requestOrigin, fetch: fetchImpl = fetch }) {
  const connector = getConnector(connectorId);
  const payload = verifyState(state, socialSecret(env));
  if (payload.connector !== connectorId || !sameSecret(payload.nonce, nonce)) {
    throw new SocialError('Cette connexion n’a pas été lancée depuis ce navigateur : relancez-la.', 400, 'invalid_state');
  }
  if (!code) throw new SocialError('Autorisation refusée ou incomplète.', 400, 'authorization_denied');
  const drafts = await connector.connect({ env, code, redirectUri: redirectUriFor(connectorId, { env, requestOrigin }), fetch: fetchImpl });
  const accounts = await social.upsertAccounts(payload.workspaceId, drafts);
  return { workspaceId: payload.workspaceId, accounts };
}

// --------------------------------------------------------------- credentials

async function freshCredentials({ social, workspaceId, accountId, env, fetch: fetchImpl, now }) {
  const { account, credentials } = await social.getAccount(workspaceId, accountId);
  const connector = connectorFor(account.platform);
  const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : null;
  if (!connector.refresh || !expiresAt || expiresAt - now() > REFRESH_MARGIN_MS) return { account, credentials };
  try {
    const refreshed = await connector.refresh({ env, fetch: fetchImpl, credentials, now: now() });
    await social.updateCredentials(workspaceId, accountId, refreshed);
    return { account, credentials: refreshed };
  } catch (error) {
    if (error instanceof SocialError && error.code === 'token_expired') await social.markNeedsReconnect(workspaceId, accountId);
    throw error;
  }
}

/** Platform options a creator can pick from (TikTok privacy levels…). Other platforms return `{}`. */
export async function accountOptions({ social, workspaceId, accountId, env = process.env, fetch: fetchImpl = fetch, now = Date.now }) {
  const { account, credentials } = await freshCredentials({ social, workspaceId, accountId, env, fetch: fetchImpl, now });
  const publisher = getPublisher(account.platform);
  return publisher.options ? publisher.options({ env, fetch: fetchImpl, account, credentials }) : {};
}

// ---------------------------------------------------------------- publishing

function pickFile(generation, fileId) {
  const files = generation.files || [];
  const file = fileId ? files.find((item) => item.id === fileId) : files.find((item) => item.role !== 'audio') || files[0];
  if (!file) throw new SocialError('Fichier introuvable pour cette création.', 404, 'file_not_found');
  return file;
}

/** Checks the server can serve the media to the networks; the link itself is built when the post is sent. */
function mediaFor(config, file) {
  if (!config) throw new SocialError('Les réseaux sociaux téléchargent le média depuis votre serveur : définissez STUDIO_PUBLIC_URL (adresse publique en https) et STUDIO_MEDIA_SECRET.', 400, 'public_url_required');
  return { kind: mediaKindOf(file.mediaType), file: file.file };
}

function mediaLink(env, workspaceId, media) {
  const config = publicMediaConfig(env);
  if (!config) throw new SocialError('STUDIO_PUBLIC_URL ou STUDIO_MEDIA_SECRET n’est plus défini : le média ne peut plus être servi aux réseaux.', 400, 'public_url_required');
  const url = publicMediaUrl(config, workspaceId, media.file);
  return { kind: media.kind, url: media.kind === 'image' ? `${url}?format=jpeg` : url };
}

function failure(error) {
  return { status: 'failed', error: error instanceof Error ? error.message : String(error), state: null };
}

/**
 * Runs one step of a publication: `start` creates the post (or the platform-side upload),
 * `advance` checks on a post that the platform is still processing. Never throws for platform errors:
 * they are recorded on the publication so one failing network does not hide the others.
 */
async function step({ social, workspaceId, publication, mode, env, fetch: fetchImpl, now }) {
  return social.studio.withLock(`advance:${publication.id}`, async () => {
    const current = await social.getPublication(workspaceId, publication.id);
    if (current.status !== 'processing') return current;
    try {
      if (mode === 'advance' && now() - Date.parse(current.startedAt || current.createdAt) > PROCESSING_TIMEOUT_MS) {
        throw new SocialError('La plateforme met trop de temps à traiter ce média.', 504, 'timeout');
      }
      const { account, credentials } = await freshCredentials({ social, workspaceId, accountId: current.accountId, env, fetch: fetchImpl, now });
      const publisher = getPublisher(account.platform);
      const result = mode === 'start'
        ? await publisher.start({ env, fetch: fetchImpl, account, credentials, media: mediaLink(env, workspaceId, current.media), caption: current.caption, options: current.options })
        : await publisher.advance({ env, fetch: fetchImpl, account, credentials, state: current.state });
      return social.updatePublication(workspaceId, current.id, {
        status: result.status,
        state: result.status === 'processing' ? result.state ?? current.state : null,
        remoteId: result.remoteId ?? current.remoteId,
        url: result.url ?? current.url,
        draft: Boolean(result.draft),
        error: null,
      });
    } catch (error) {
      if (error instanceof SocialError && error.code === 'network_error' && mode === 'advance') {
        return social.updatePublication(workspaceId, current.id, { error: error.message });
      }
      if (error instanceof SocialError && error.code === 'token_expired') await social.markNeedsReconnect(workspaceId, current.accountId);
      return social.updatePublication(workspaceId, current.id, failure(error));
    }
  });
}

function scheduleTime(value, nowMs) {
  if (!value) return null;
  const time = Date.parse(value);
  if (time < nowMs + SCHEDULE_MIN_LEAD_MS) throw new SocialError('L’heure de publication doit être dans le futur (au moins une minute).', 400, 'invalid_schedule');
  if (time > nowMs + SCHEDULE_MAX_LEAD_MS) throw new SocialError('On ne peut pas programmer à plus d’un an.', 400, 'invalid_schedule');
  return new Date(time).toISOString();
}

/**
 * Sends one creation to several accounts of the workspace. Platforms that finish instantly come back
 * `published`; the others stay `processing` and are followed with `refreshPublication`.
 * With `scheduledAt` nothing is sent yet: publications wait as `scheduled` for `runDuePublications`.
 */
export async function publishGeneration({ social, workspaceId, input, env = process.env, fetch: fetchImpl = fetch, now = Date.now, sleep = sleepFor, settle = { attempts: 4, delayMs: 1500 } }) {
  const request = publishRequestSchema.parse(input);
  const generation = await social.studio.getGeneration(workspaceId, request.generationId);
  const file = pickFile(generation, request.fileId);
  const media = mediaFor(publicMediaConfig(env), file);
  const scheduledAt = scheduleTime(request.scheduledAt, now());

  const targets = [];
  const blocked = [];
  for (const target of request.targets) {
    const { account } = await social.getAccount(workspaceId, target.accountId);
    const caption = (target.caption ?? request.caption).trim();
    const errors = checkPublishable({ platform: account.platform, kind: media.kind, aspectRatio: generation.params?.aspectRatio, caption }).filter((issue) => issue.level === 'error');
    if (account.status === 'needs_reconnect') errors.push({ level: 'error', message: `Le compte ${account.name} doit être reconnecté.` });
    if (errors.length) blocked.push({ accountId: account.id, account: `${PLATFORM_LABELS[account.platform]} · ${account.name}`, errors: errors.map((issue) => issue.message) });
    targets.push({ account, caption, options: target.options });
  }
  if (blocked.length) {
    throw new SocialError(blocked.flatMap((item) => item.errors.map((message) => `${item.account} : ${message}`)).join(' '), 400, 'not_publishable', blocked);
  }

  const publications = await Promise.all(targets.map(async ({ account, caption, options }) => {
    let publication = await social.createPublication(workspaceId, {
      generationId: generation.id,
      fileId: file.id,
      accountId: account.id,
      platform: account.platform,
      accountName: account.name,
      caption,
      options,
      media,
      ...(scheduledAt ? { status: 'scheduled', scheduledAt } : {}),
    });
    if (scheduledAt) return publication;
    publication = await step({ social, workspaceId, publication, mode: 'start', env, fetch: fetchImpl, now });
    for (let attempt = 1; publication.status === 'processing' && attempt < settle.attempts; attempt += 1) {
      await sleep(settle.delayMs);
      publication = await step({ social, workspaceId, publication, mode: 'advance', env, fetch: fetchImpl, now });
    }
    return publication;
  }));
  return publications.map(publicPublication);
}

/**
 * One scheduler tick over every workspace: sends the scheduled publications that are due and
 * moves forward the ones the platforms are still processing (a Reel started at 9:00 is finished
 * even when nobody has the studio open). Returns the publications it touched.
 */
export async function runDuePublications({ social, env = process.env, fetch: fetchImpl = fetch, now = Date.now }) {
  const touched = [];
  for (const workspace of await social.studio.listWorkspaces()) {
    for (const publication of await social.listPublications(workspace.id, { limit: Number.MAX_SAFE_INTEGER })) {
      let current = null;
      if (publication.status === 'scheduled' && Date.parse(publication.scheduledAt) <= now()) {
        const claimed = await social.claimScheduled(workspace.id, publication.id, now());
        if (claimed) current = await step({ social, workspaceId: workspace.id, publication: claimed, mode: 'start', env, fetch: fetchImpl, now });
      } else if (publication.status === 'processing' && publication.state) {
        current = await step({ social, workspaceId: workspace.id, publication, mode: 'advance', env, fetch: fetchImpl, now });
      }
      if (current) touched.push(publicPublication(current));
    }
  }
  return touched;
}

export async function refreshPublication({ social, workspaceId, publicationId, env = process.env, fetch: fetchImpl = fetch, now = Date.now }) {
  const publication = await social.getPublication(workspaceId, publicationId);
  if (publication.status !== 'processing') return publicPublication(publication);
  return publicPublication(await step({ social, workspaceId, publication, mode: 'advance', env, fetch: fetchImpl, now }));
}

/** Drops the internal media URL and platform state before a publication leaves the server. */
export function publicPublication(publication) {
  const view = { ...publication };
  delete view.media;
  delete view.state;
  return view;
}
