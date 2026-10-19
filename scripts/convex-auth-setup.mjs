#!/usr/bin/env node
/**
 * Prepares a Convex deployment for signing the owner in (LOGIN_PROVIDER=convex).
 *
 *   npm run convex:auth-setup              local deployment
 *   npm run convex:auth-setup -- --prod    production deployment
 *   add --rotate to replace the keys (everybody is signed out)
 *
 * Convex signs the session tokens with its own key pair (JWT_PRIVATE_KEY / JWKS, stored in the deployment, never in this
 * repository) and must know the owner's address (ALLOWED_EMAILS) and the studio's address (SITE_URL).
 * Run `npm run convex:create-owner` afterwards to create the owner's account.
 */
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { spawnSync } from 'node:child_process';
import { loadLocalEnv } from '../mcp/server.mjs';

const production = process.argv.includes('--prod');
const rotate = process.argv.includes('--rotate');
const env = loadLocalEnv(process.cwd(), { ...process.env });
const target = production ? ['--prod'] : [];

function convexEnv(args, input) {
  return spawnSync('npx', ['convex', 'env', ...args, ...target], { encoding: 'utf8', input, env: { ...process.env, ...(production ? {} : { CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE }) } });
}

// The value goes through stdin: a key starting with "-----BEGIN" would be read as an option, and recent CLIs reject `--`.
function setVariable(name, value) {
  const result = convexEnv(['set', name], value);
  if (result.status !== 0) {
    console.error(`Convex a refusé ${name} : ${result.stderr || result.stdout}\nLe déploiement existe-t-il ? (lancez d'abord \`npx convex dev\` ou \`npx convex login\`)`);
    process.exit(result.status || 1);
  }
}

const hasKeys = !rotate && convexEnv(['get', 'JWT_PRIVATE_KEY']).stdout.trim() !== '';
if (!hasKeys) {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const jwks = JSON.stringify({ keys: [{ use: 'sig', alg: 'RS256', ...(await exportJWK(publicKey)) }] });
  setVariable('JWT_PRIVATE_KEY', pem.trimEnd().replace(/\n/g, ' '));
  setVariable('JWKS', jwks);
  console.log(rotate ? 'Clés de session remplacées : tout le monde doit se reconnecter.' : 'Clés de session créées dans Convex.');
} else {
  console.log('Clés de session déjà présentes (--rotate pour les remplacer).');
}

const site = env.STUDIO_PUBLIC_URL || env.AUTH_URL || env.NEXTAUTH_URL;
if (site) setVariable('SITE_URL', site);
if (env.ALLOWED_EMAILS) setVariable('ALLOWED_EMAILS', env.ALLOWED_EMAILS);
const missing = [!site && 'STUDIO_PUBLIC_URL', !env.ALLOWED_EMAILS && 'ALLOWED_EMAILS'].filter(Boolean);
if (missing.length) console.warn(`Non défini : ${missing.join(', ')} — la connexion Convex refusera tout le monde sans ALLOWED_EMAILS.`);
console.log(`Convex est prêt à connecter le propriétaire (${production ? 'production' : 'local'}). Étape suivante : npm run convex:create-owner${production ? ' -- --prod' : ''}`);
