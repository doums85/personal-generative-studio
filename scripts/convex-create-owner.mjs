#!/usr/bin/env node
/**
 * Creates the owner's account in Convex, or changes its password (every device is signed out).
 *
 *   npm run convex:create-owner -- --email you@example.com        asks for the password (typed, hidden)
 *   STUDIO_OWNER_PASSWORD=… npm run convex:create-owner            non-interactive
 *   npm run convex:create-owner -- --generate                      invents a strong password and prints it once
 *
 * The email defaults to the first address of ALLOWED_EMAILS. Talks to the deployment named by CONVEX_URL with the
 * studio's server key, like the web app does; for production, run it with the production CONVEX_URL and key.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { loadLocalEnv } from '../mcp/server.mjs';
import { ConvexService, api, convexSettings } from '../lib/convex/service.mjs';

const env = loadLocalEnv(process.cwd(), { ...process.env });
const settings = convexSettings(env);
if (!settings) {
  console.error('CONVEX_URL n’est pas défini : lancez `npm run convex:dev` (local) ou renseignez CONVEX_URL et STUDIO_SERVICE_PRIVATE_KEY.');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const email = (flag('--email') || (env.ALLOWED_EMAILS || '').split(',')[0] || '').trim().toLowerCase();
if (!email) {
  console.error('Indiquez l’adresse : --email vous@exemple.com (ou renseignez ALLOWED_EMAILS).');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = function write(text) { if (!this.stdoutMuted) process.stdout.write(text); };
    process.stdout.write(question);
    rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

let password = env.STUDIO_OWNER_PASSWORD;
const generated = args.includes('--generate');
if (generated) password = randomBytes(18).toString('base64url');
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('Aucun mot de passe : définissez STUDIO_OWNER_PASSWORD, utilisez --generate, ou lancez la commande dans un terminal.');
    process.exit(1);
  }
  password = await askHidden('Mot de passe (12 caractères minimum) : ');
  if (password !== await askHidden('Confirmez : ')) {
    console.error('Les deux mots de passe sont différents.');
    process.exit(1);
  }
}

try {
  const result = await new ConvexService(settings).action(api.authAdmin.setOwnerPassword, { email, password });
  console.log(`${result.created ? 'Compte créé' : 'Mot de passe remplacé (appareils déconnectés)'} pour ${email}.`);
  if (generated) console.log(`Mot de passe : ${password}\nNotez-le maintenant : il ne sera plus affiché.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
