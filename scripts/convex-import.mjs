#!/usr/bin/env node
/**
 * Copies an existing studio library (the JSON files and media under STUDIO_DATA_DIR) into Convex.
 *
 *   npm run convex:import             copies everything
 *   npm run convex:import -- --dry-run   only reports what would be copied
 *
 * Ids and dates are kept as they are, and the script can be re-run: what is already in Convex is skipped.
 * Social tokens are copied encrypted, so keep the same SOCIAL_TOKEN_SECRET (or AUTH_SECRET).
 */
import { loadLocalEnv } from '../mcp/server.mjs';
import { ConvexService, api, convexSettings } from '../lib/convex/service.mjs';
import { StudioStore, resolveDataDir } from '../lib/studio/store.mjs';

const dryRun = process.argv.includes('--dry-run');
const env = loadLocalEnv();
const settings = convexSettings(env);
if (!settings) {
  console.error('CONVEX_URL n’est pas défini : lancez `npx convex dev` (ou renseignez CONVEX_URL) avant d’importer.');
  process.exit(1);
}

const dataDir = resolveDataDir(env, process.cwd());
const files = new StudioStore({ rootDir: dataDir });
const convex = new ConvexService(settings);
const totals = { workspaces: 0, elements: 0, generations: 0, media: 0, accounts: 0, publications: 0, skipped: 0 };

function withoutId({ id, ...rest }, workspaceUid) {
  return { uid: id, workspaceUid, ...rest };
}

async function copyMedia(workspaceId, file, createdAt) {
  if (await convex.query(api.library.hasMedia, { workspaceUid: workspaceId, file })) return;
  totals.media += 1;
  if (dryRun) return;
  const { buffer, mediaType } = await files.readMedia(workspaceId, file);
  const storageId = await convex.upload(buffer, mediaType);
  await convex.mutation(api.library.registerMedia, { workspaceUid: workspaceId, file, storageId, mediaType, bytes: buffer.length, createdAt });
}

async function insert(reference, args, counter) {
  if (dryRun) { totals[counter] += 1; return; }
  if (await convex.mutation(reference, args)) totals[counter] += 1;
  else totals.skipped += 1;
}

console.log(`${dryRun ? '[essai à blanc] ' : ''}Lecture de ${dataDir}`);
for (const workspace of await files.listWorkspaces()) {
  const elements = await files.readJson(files.elementsFile(workspace.id), []);
  const generations = await files.readJson(files.generationsFile(workspace.id), []);
  const accounts = await files.readJson(`${files.workspaceDir(workspace.id)}/social-accounts.json`, []);
  const publications = await files.readJson(`${files.workspaceDir(workspace.id)}/publications.json`, []);
  console.log(`- ${workspace.name}: ${elements.length} élément(s), ${generations.length} création(s), ${accounts.length} compte(s), ${publications.length} publication(s)`);

  const counts = {
    elements: elements.length,
    generations: generations.length,
    images: generations.filter((item) => item.kind === 'image').length,
    videos: generations.filter((item) => item.kind === 'video' || item.kind === 'talking').length,
  };
  const spentUsd = generations.reduce((total, item) => total + (Number(item.estimate?.amount) || 0), 0);
  await insert(api.library.importWorkspace, { uid: workspace.id, name: workspace.name, description: workspace.description || '', settings: workspace.settings || {}, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt, counts, spentUsd }, 'workspaces');

  for (const element of elements) {
    for (const image of element.images || []) await copyMedia(workspace.id, image.file, image.createdAt || element.createdAt);
    await insert(api.library.importElement, JSON.parse(JSON.stringify(withoutId(element, workspace.id))), 'elements');
  }
  for (const generation of generations) {
    for (const file of generation.files || []) await copyMedia(workspace.id, file.file, generation.createdAt);
    const doc = withoutId(generation, workspace.id);
    await insert(api.library.importGeneration, JSON.parse(JSON.stringify({ ...doc, model: doc.model ?? null, estimate: doc.estimate ?? null, parentId: doc.parentId ?? null, durationMs: doc.durationMs ?? null })), 'generations');
  }
  for (const account of accounts) await insert(api.social.importAccount, JSON.parse(JSON.stringify({ ...withoutId(account, workspace.id), handle: account.handle ?? null, avatarUrl: account.avatarUrl ?? null })), 'accounts');
  for (const publication of publications) {
    const doc = withoutId(publication, workspace.id);
    await insert(api.social.importPublication, JSON.parse(JSON.stringify({ ...doc, state: doc.state ?? null, remoteId: doc.remoteId ?? null, url: doc.url ?? null, error: doc.error ?? null, startedAt: doc.startedAt ?? null, publishedAt: doc.publishedAt ?? null })), 'publications');
  }
}

console.log(`\n${dryRun ? 'À copier' : 'Copié'} : ${totals.workspaces} projet(s), ${totals.elements} élément(s), ${totals.generations} création(s), ${totals.media} fichier(s), ${totals.accounts} compte(s), ${totals.publications} publication(s). Déjà présents (ignorés) : ${totals.skipped}.`);
