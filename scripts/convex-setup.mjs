#!/usr/bin/env node
/**
 * Creates the key pair that lets the studio's servers talk to Convex.
 *
 *   npm run convex:setup              local deployment: writes the private key to .env.local
 *   npm run convex:setup -- --prod    production deployment: prints the private key to put in your host's environment
 *   add --rotate to replace an existing key
 *
 * The private key stays on the servers (STUDIO_SERVICE_PRIVATE_KEY); the public half is stored in the
 * Convex deployment (STUDIO_SERVICE_JWKS), which only accepts tokens signed with the matching key.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ENV_FILE = '.env.local';
const KEY_NAME = 'STUDIO_SERVICE_PRIVATE_KEY';
const production = process.argv.includes('--prod');
const rotate = process.argv.includes('--rotate');

function readEnvFile() {
  return existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
}

function existingKey() {
  const match = readEnvFile().match(new RegExp(`^${KEY_NAME}=(.+)$`, 'm'));
  return match ? Buffer.from(match[1].trim(), 'base64').toString('utf8') : null;
}

let pem = !production && !rotate ? existingKey() : null;
const generated = !pem;
if (generated) pem = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;

const publicJwk = createPublicKey(createPrivateKey(pem)).export({ format: 'jwk' });
const jwks = JSON.stringify({ keys: [{ ...publicJwk, kid: 'studio-service', alg: 'RS256', use: 'sig' }] });

const result = spawnSync('npx', ['convex', 'env', 'set', 'STUDIO_SERVICE_JWKS', jwks, ...(production ? ['--prod'] : [])], { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('\nConvex n’a pas enregistré la clé publique. Lancez d’abord `npx convex dev` (ou `npx convex login`) pour créer le déploiement.');
  process.exit(result.status || 1);
}

const encoded = Buffer.from(pem).toString('base64');
if (production) {
  console.log(`\nClé publique enregistrée sur le déploiement de production.\nAjoutez ceci aux variables d'environnement de votre hébergeur (Vercel, Docker…), et nulle part ailleurs :\n\n${KEY_NAME}=${encoded}\n`);
} else {
  const lines = readEnvFile().split('\n').filter((line) => !line.startsWith(`${KEY_NAME}=`));
  writeFileSync(ENV_FILE, `${lines.join('\n').replace(/\n+$/, '')}\n${KEY_NAME}=${encoded}\n`);
  console.log(`\n${generated ? 'Clé créée' : 'Clé existante réutilisée'} : ${KEY_NAME} est dans ${ENV_FILE} et la clé publique est enregistrée sur Convex.`);
}
