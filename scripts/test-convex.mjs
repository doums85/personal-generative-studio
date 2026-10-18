#!/usr/bin/env node
/**
 * Runs the Convex contract tests against a real local Convex backend (no account needed):
 * starts `convex dev` in anonymous mode, waits for the functions to be deployed, runs tests/convex/*.test.mjs, stops it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { loadLocalEnv } from '../mcp/server.mjs';
import { CONVEX_AUTH_ENV, CONVEX_PLATFORM_ENV } from '../tests/convex/fake-platform.mjs';

const env = { ...process.env, CONVEX_AGENT_MODE: 'anonymous' };
loadLocalEnv(process.cwd(), env);
if (!env.STUDIO_SERVICE_PRIVATE_KEY || !existsSync('.env.local') || !readFileSync('.env.local', 'utf8').includes('CONVEX_DEPLOYMENT')) {
  console.log('Première utilisation : création du déploiement local et de la clé du serveur…');
  const dev = spawnSync('npx', ['convex', 'dev', '--once', '--until-success'], { env, stdio: 'inherit' });
  if (dev.status !== 0) console.log('(le premier déploiement attend la clé : normal)');
  const setup = spawnSync('node', ['scripts/convex-setup.mjs'], { env, stdio: 'inherit' });
  if (setup.status !== 0) process.exit(setup.status || 1);
  loadLocalEnv(process.cwd(), env);
}

let backend = null;
const stop = () => { try { process.kill(-backend.pid, 'SIGTERM'); } catch { /* already stopped */ } };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

/** Starts `convex dev` and resolves with its log once the functions are deployed, or null if it died first. */
function startBackend() {
  backend = spawn('npx', ['convex', 'dev'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  return new Promise((resolve) => {
    let log = '';
    const timer = setTimeout(() => resolve({ ok: false, log }), 180000);
    const onData = (chunk) => {
      log += chunk.toString();
      if (/Convex functions ready/.test(log)) { clearTimeout(timer); resolve({ ok: true, log }); }
    };
    backend.stdout.on('data', onData);
    backend.stderr.on('data', onData);
    backend.on('exit', () => { clearTimeout(timer); resolve({ ok: false, log }); });
  });
}

// The first start may fail on a transient network error while Convex downloads its dashboard: try twice.
let started = await startBackend();
if (!started.ok) {
  stop();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  started = await startBackend();
}
if (!started.ok) {
  console.error(`Le backend Convex n'a pas démarré :\n${started.log.split('\n').slice(-15).join('\n')}`);
  stop();
  process.exit(1);
}

// Convex sends the posts itself: point it at the fake networks the tests start, with the same secrets as the tests.
for (const [name, value] of Object.entries(CONVEX_PLATFORM_ENV)) {
  const result = spawnSync('npx', ['convex', 'env', 'set', name, value], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) { stop(); process.exit(result.status || 1); }
}

// Convex signs the owner in with its own keys: create them, and allow the address the tests use.
const authSetup = spawnSync('node', ['scripts/convex-auth-setup.mjs'], { env: { ...env, ...CONVEX_AUTH_ENV }, stdio: ['ignore', 'ignore', 'inherit'] });
if (authSetup.status !== 0) { stop(); process.exit(authSetup.status || 1); }

const tests = spawnSync('node', ['--test', '--test-concurrency=1', 'tests/convex/*.test.mjs'], { env, stdio: 'inherit' });
stop();
process.exit(tests.status ?? 1);
