#!/usr/bin/env node
/**
 * Copies the settings Convex needs to publish into the deployment's environment. Convex sends the posts itself
 * (scheduled ones at their exact time), so it must know the app credentials, the key that decrypts the stored
 * tokens, and the public address of this studio (the networks download the media from it).
 *
 *   npm run convex:sync-env              local deployment
 *   npm run convex:sync-env -- --prod    production deployment
 *   add --dry-run to only list what would be sent
 *
 * Values come from the environment and .env.local. Run it again after changing any of them.
 */
import { spawnSync } from 'node:child_process';
import { loadLocalEnv } from '../mcp/server.mjs';

const production = process.argv.includes('--prod');
const dryRun = process.argv.includes('--dry-run');
const env = loadLocalEnv(process.cwd(), { ...process.env });

// Convex has no AUTH_SECRET: the fallbacks the web app applies are resolved here.
const values = {
  SOCIAL_TOKEN_SECRET: env.SOCIAL_TOKEN_SECRET || env.AUTH_SECRET,
  STUDIO_MEDIA_SECRET: env.STUDIO_MEDIA_SECRET || env.AUTH_SECRET,
  STUDIO_PUBLIC_URL: env.STUDIO_PUBLIC_URL,
  META_APP_ID: env.META_APP_ID,
  META_APP_SECRET: env.META_APP_SECRET,
  META_GRAPH_VERSION: env.META_GRAPH_VERSION,
  TIKTOK_CLIENT_KEY: env.TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET: env.TIKTOK_CLIENT_SECRET,
  // Only for tests against a local fake of the networks.
  META_GRAPH_BASE_URL: env.META_GRAPH_BASE_URL,
  TIKTOK_API_BASE_URL: env.TIKTOK_API_BASE_URL,
};

const sent = [];
const skipped = [];
for (const [name, value] of Object.entries(values)) {
  if (!value) { skipped.push(name); continue; }
  if (!dryRun) {
    const result = spawnSync('npx', ['convex', 'env', 'set', name, value, ...(production ? ['--prod'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (result.status !== 0) {
      console.error(`Convex a refusé ${name}. Le déploiement existe-t-il ? (lancez d'abord \`npx convex dev\` ou \`npx convex login\`)`);
      process.exit(result.status || 1);
    }
  }
  sent.push(name);
}

console.log(`${dryRun ? 'À envoyer' : 'Envoyé'} à Convex (${production ? 'production' : 'local'}) : ${sent.join(', ') || 'rien'}`);
if (skipped.length) console.log(`Non défini, ignoré : ${skipped.join(', ')}`);
const essentials = ['SOCIAL_TOKEN_SECRET', 'STUDIO_MEDIA_SECRET', 'STUDIO_PUBLIC_URL'].filter((name) => skipped.includes(name));
if (essentials.length) console.warn(`\nAttention : sans ${essentials.join(', ')}, Convex ne pourra pas publier.`);
