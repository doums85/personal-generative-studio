import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { MEDIA_TYPE_BY_EXTENSION } from '../lib/gateway/media-files.mjs';
import { SocialError } from '../lib/social/errors.mjs';
import { PLATFORM_LABELS } from '../lib/social/platforms.mjs';
import { checkPublishable, mediaKindOf } from '../lib/social/rules.mjs';
import { publicMediaConfig } from '../lib/studio/public-media.mjs';
import { publishGeneration, refreshPublication } from '../lib/social/service.mjs';

const MAX_IMPORT_BYTES = 150 * 1024 * 1024;

const accountLabel = (account) => `${PLATFORM_LABELS[account.platform] || account.platform} · ${account.name}`;

/**
 * Matches what the model typed against the workspace's accounts: an id, `instagram` (when the project has
 * one account on that network), `instagram:Maison Aya`, a handle or a unique account name.
 */
export function resolveAccounts(accounts, references) {
  if (!accounts.length) throw new SocialError('No social account is connected to this workspace. Connect one in the web app (Réseaux sociaux).', 404, 'no_accounts');
  const chosen = new Map();
  for (const reference of references) {
    const needle = reference.trim().toLowerCase();
    const matches = [
      accounts.filter((account) => account.id === reference.trim()),
      accounts.filter((account) => `${account.platform}:${account.name}`.toLowerCase() === needle || (account.handle || '').toLowerCase() === needle),
      accounts.filter((account) => account.platform === needle),
      accounts.filter((account) => account.name.toLowerCase() === needle),
    ].find((group) => group.length);
    if (!matches) throw new SocialError(`No account matches "${reference}". Available: ${accounts.map((account) => `${account.platform}:${account.name} (${account.id})`).join(', ')}`, 404, 'account_not_found');
    if (matches.length > 1) throw new SocialError(`"${reference}" matches several accounts; use an id or "platform:name": ${matches.map((account) => `${account.platform}:${account.name} (${account.id})`).join(', ')}`, 400, 'ambiguous_account');
    chosen.set(matches[0].id, matches[0]);
  }
  return [...chosen.values()];
}

function describePublication(publication) {
  const head = `${PLATFORM_LABELS[publication.platform] || publication.platform} · ${publication.accountName}`;
  switch (publication.status) {
    case 'published': return `- ${head}: ${publication.draft ? 'sent to the TikTok app as a draft' : 'published'}${publication.url ? ` — ${publication.url}` : ''}`;
    case 'scheduled': return `- ${head}: scheduled for ${publication.scheduledAt}`;
    case 'processing': return `- ${head}: processing on the platform (id ${publication.id}) — call list_publications to follow it`;
    default: return `- ${head}: FAILED — ${publication.error || 'unknown error'}`;
  }
}

/** Reads a local file or a hosted link and normalizes it to `{ bytes, mediaType, label }`. */
async function loadMedia({ file, url, cwd, remote, fetchImpl }) {
  if (file) {
    if (remote) throw new SocialError('Local file paths are not available on the hosted endpoint: pass `url` (a link returned by generate_*) or `generation`.', 400, 'invalid_media');
    const resolved = path.resolve(cwd, file);
    const mediaType = MEDIA_TYPE_BY_EXTENSION[path.extname(resolved).slice(1).toLowerCase()];
    if (!mediaType || !mediaKindOf(mediaType)) throw new SocialError(`"${file}" must be an image or a video (PNG, JPEG, WebP, MP4, WebM, MOV…).`, 400, 'invalid_media');
    let bytes;
    try { bytes = await readFile(resolved); } catch { throw new SocialError(`File not found: ${resolved}`, 404, 'invalid_media'); }
    if (bytes.length > MAX_IMPORT_BYTES) throw new SocialError(`${file} is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`, 400, 'invalid_media');
    return { bytes, mediaType, label: path.basename(resolved) };
  }
  if (!remote?.fetchOwn) throw new SocialError('`url` is only supported on the hosted endpoint; use `file` with a local path or `generation` with a library id.', 400, 'invalid_media');
  const fetched = await remote.fetchOwn(url, fetchImpl);
  if (!fetched) throw new SocialError('Only links returned by this studio\'s generate_* tools can be published.', 400, 'invalid_media');
  const mediaType = (fetched.mediaType || MEDIA_TYPE_BY_EXTENSION[path.extname(new URL(url).pathname).slice(1).toLowerCase()] || '').split(';')[0].trim();
  if (!mediaKindOf(mediaType)) throw new SocialError('The link is not an image or a video.', 400, 'invalid_media');
  if (fetched.bytes.length > MAX_IMPORT_BYTES) throw new SocialError(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`, 400, 'invalid_media');
  return { bytes: fetched.bytes, mediaType, label: path.basename(new URL(url).pathname) };
}

/**
 * Registers the social publishing tools. They act on the accounts connected to a workspace in the web app
 * and need the same `STUDIO_DATA_DIR`, `SOCIAL_TOKEN_SECRET` and public media settings as the web app.
 */
export function registerSocialTools(server, { store, social, env, fetch: fetchImpl = fetch, now, cwd, remote, resolveWorkspace, errorResult }) {
  const workspaceSchema = z.string().optional().describe('Studio workspace id or name (see list_workspaces). Defaults to the most recently used workspace. Social accounts belong to one workspace.');

  server.registerTool('list_social_accounts', {
    title: 'List social accounts',
    description: 'Lists the Facebook, Instagram and TikTok accounts connected to a workspace (connected in the web app under "Réseaux sociaux"). Use the returned ids or "platform:name" with publish_to_social.',
    inputSchema: { workspace: workspaceSchema },
    annotations: { readOnlyHint: true },
  }, async ({ workspace: reference }) => {
    try {
      const workspace = await resolveWorkspace(reference);
      const accounts = await social.listAccounts(workspace.id);
      const text = accounts.length
        ? `Workspace "${workspace.name}"\n${accounts.map((account) => `- ${accountLabel(account)}${account.handle ? ` ${account.handle}` : ''} (${account.id})${account.status === 'needs_reconnect' ? ' — NEEDS RECONNECTION in the web app' : ''}`).join('\n')}`
        : `Workspace "${workspace.name}" has no connected social account. Connect Facebook, Instagram or TikTok in the web app (Réseaux sociaux).`;
      return { content: [{ type: 'text', text }], structuredContent: { workspace: { id: workspace.id, name: workspace.name }, accounts: accounts.map(({ id, platform, name, handle, status }) => ({ id, platform, name, handle, status })) } };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_generations', {
    title: 'List library generations',
    description: 'Lists the most recent images and videos of a workspace gallery with their ids, for publish_to_social\'s `generation` argument.',
    inputSchema: {
      workspace: workspaceSchema,
      kind: z.enum(['image', 'video']).optional(),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum number of items (default 15)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ workspace: reference, kind, limit = 15 }) => {
    try {
      const workspace = await resolveWorkspace(reference);
      const generations = (await store.listGenerations(workspace.id, { kind, limit: 200 })).filter((item) => item.kind === 'image' || item.kind === 'video' || item.kind === 'talking').slice(0, limit);
      const rows = generations.map((item) => ({ id: item.id, kind: item.kind, prompt: item.prompt.slice(0, 120), model: item.model?.id || null, aspectRatio: item.params?.aspectRatio || null, createdAt: item.createdAt }));
      const text = rows.length
        ? `Workspace "${workspace.name}"\n${rows.map((row) => `- ${row.id} · ${row.kind}${row.aspectRatio ? ` ${row.aspectRatio}` : ''} · ${row.prompt}`).join('\n')}`
        : `Workspace "${workspace.name}" has no image or video in its gallery.`;
      return { content: [{ type: 'text', text }], structuredContent: { workspace: { id: workspace.id, name: workspace.name }, generations: rows } };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('publish_to_social', {
    title: 'Publish to social networks',
    description: [
      'Publishes an image or video to Facebook, Instagram and/or TikTok accounts connected to a workspace, now or at `scheduledAt`.',
      'THIS POSTS PUBLICLY AND CANNOT BE UNDONE WITH THIS TOOL: only call it when the user explicitly asked to publish, with the caption they approved. Call it with dryRun=true first to check the media and caption without sending anything.',
      'Give exactly one media source: `file` (local path, e.g. a file returned by generate_image), `url` (a link returned by generate_* on the hosted endpoint) or `generation` (id from list_generations).',
      'Instagram images must be between 4:5 and 1.91:1; videos become Reels. TikTok defaults to private ("SELF_ONLY") visibility unless `tiktokPrivacy` is given; `tiktokMode: "draft"` sends the media to the creator\'s TikTok app instead of posting.',
      'Instagram and TikTok process media on their side: a result may say "processing" — follow it with list_publications.',
    ].join(' '),
    inputSchema: {
      accounts: z.array(z.string().min(1)).min(1).max(10).describe('Accounts from list_social_accounts: ids, "instagram" (if the workspace has a single Instagram account), "instagram:Name" or an @handle.'),
      caption: z.string().max(5000).optional().describe('Caption / description with hashtags. Instagram: 2200 characters max, 30 hashtags max.'),
      file: z.string().optional().describe('Local image or video path (local server only). It is added to the workspace gallery.'),
      url: z.string().url().optional().describe('Link returned by a generate_* tool (hosted endpoint only). It is added to the workspace gallery.'),
      generation: z.string().optional().describe('Gallery generation id (see list_generations).'),
      workspace: workspaceSchema,
      aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional().describe('Aspect ratio of an imported file or url, e.g. "9:16"; lets the pre-flight check enforce Instagram and TikTok formats.'),
      scheduledAt: z.iso.datetime({ offset: true }).optional().describe('ISO 8601 time with offset, e.g. 2026-10-20T09:00:00+02:00 (between one minute and one year ahead). Omit to publish now.'),
      tiktokMode: z.enum(['publish', 'draft']).optional(),
      tiktokPrivacy: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).optional().describe('Defaults to SELF_ONLY; unaudited TikTok apps can only use SELF_ONLY.'),
      dryRun: z.boolean().optional().describe('Check everything and report, without importing the media or sending anything.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ accounts: references, caption = '', file, url, generation: generationId, workspace: reference, aspectRatio, scheduledAt, tiktokMode, tiktokPrivacy, dryRun = false }) => {
    try {
      if ([file, url, generationId].filter(Boolean).length !== 1) throw new SocialError('Give exactly one of `file`, `url` or `generation`.', 400, 'invalid_media');
      const workspace = await resolveWorkspace(reference);
      const targets = resolveAccounts(await social.listAccounts(workspace.id), references);
      const text = caption.trim();

      let source = null;
      let generation = null;
      if (generationId) {
        generation = await store.getGeneration(workspace.id, generationId);
        const output = generation.files.find((item) => item.role !== 'audio') || generation.files[0];
        source = { kind: mediaKindOf(output?.mediaType), aspectRatio: generation.params?.aspectRatio, fileId: output?.id };
      } else {
        const media = await loadMedia({ file, url, cwd, remote, fetchImpl });
        source = { kind: mediaKindOf(media.mediaType), aspectRatio, media };
      }

      if (dryRun) {
        const lines = targets.map((account) => {
          const issues = checkPublishable({ platform: account.platform, kind: source.kind, aspectRatio: source.aspectRatio, caption: text });
          if (account.status === 'needs_reconnect') issues.push({ level: 'error', message: 'The account must be reconnected in the web app.' });
          return `- ${accountLabel(account)}: ${issues.length ? issues.map((issue) => `${issue.level.toUpperCase()} ${issue.message}`).join(' ') : 'ready'}`;
        });
        if (!publicMediaConfig(env)) lines.push('- SERVER: STUDIO_PUBLIC_URL / STUDIO_MEDIA_SECRET are not set, so the networks could not download the media.');
        return { content: [{ type: 'text', text: `Dry run for workspace "${workspace.name}" — nothing was sent.\n${lines.join('\n')}` }], structuredContent: { dryRun: true, ready: !lines.some((line) => /ERROR|SERVER/.test(line)) } };
      }

      if (source.media) {
        generation = await store.createGeneration(workspace.id, {
          kind: source.kind,
          modality: source.kind,
          prompt: text || source.media.label,
          params: { aspectRatio: source.aspectRatio, imported: true },
          media: [{ mediaType: source.media.mediaType, uint8Array: new Uint8Array(source.media.bytes) }],
        });
        source.fileId = generation.files[0].id;
      }

      const publications = await publishGeneration({
        social,
        workspaceId: workspace.id,
        env,
        fetch: fetchImpl,
        now: () => now().getTime(),
        input: {
          generationId: generation.id,
          fileId: source.fileId,
          caption: text,
          scheduledAt,
          targets: targets.map((account) => ({ accountId: account.id, options: account.platform === 'tiktok' ? { mode: tiktokMode, privacyLevel: tiktokPrivacy } : {} })),
        },
      });
      const failed = publications.filter((item) => item.status === 'failed').length;
      return {
        isError: failed === publications.length ? true : undefined,
        content: [{ type: 'text', text: `Workspace "${workspace.name}" — generation ${generation.id}\n${publications.map((item) => describePublication(item)).join('\n')}` }],
        structuredContent: { generation: generation.id, publications: publications.map(({ id, platform, accountName, status, url: link, scheduledAt: at, draft, error }) => ({ id, platform, account: accountName, status, url: link, scheduledAt: at, draft, error })) },
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_publications', {
    title: 'List social publications',
    description: 'Lists the publications of a workspace (scheduled, processing, published, failed). Publications still processing on Instagram or TikTok are checked with the platform first, so call this to follow a publish_to_social result.',
    inputSchema: {
      workspace: workspaceSchema,
      generation: z.string().optional().describe('Only publications of this gallery generation.'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum number of items (default 15)'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ workspace: reference, generation, limit = 15 }) => {
    try {
      const workspace = await resolveWorkspace(reference);
      const listed = (await social.listPublications(workspace.id, { generationId: generation, limit }));
      const publications = [];
      for (const item of listed) {
        publications.push(item.status === 'processing'
          ? await refreshPublication({ social, workspaceId: workspace.id, publicationId: item.id, env, fetch: fetchImpl, now: () => now().getTime() })
          : { ...item, media: undefined, state: undefined });
      }
      const text = publications.length ? `Workspace "${workspace.name}"\n${publications.map((item) => describePublication(item)).join('\n')}` : `Workspace "${workspace.name}" has no publication yet.`;
      return { content: [{ type: 'text', text }], structuredContent: { workspace: { id: workspace.id, name: workspace.name }, publications: publications.map(({ id, generationId, platform, accountName, status, url: link, scheduledAt, draft, error, createdAt }) => ({ id, generation: generationId, platform, account: accountName, status, url: link, scheduledAt, draft, error, createdAt })) } };
    } catch (error) {
      return errorResult(error);
    }
  });
}
