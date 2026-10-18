import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ConvexError } from 'convex/values';
import { SERVICE_AUDIENCE, SERVICE_ISSUER } from '../../lib/convex/constants.mjs';
import { convexSettings, translateError } from '../../lib/convex/service.mjs';
import { ConvexStudioStore } from '../../lib/convex/studio-store.mjs';
import { createStudioStore } from '../../lib/studio/backend.mjs';
import { SocialError } from '../../lib/social/errors.mjs';
import { getSocialStore, SocialStore } from '../../lib/social/store.mjs';
import { ConvexSocialStore } from '../../lib/convex/social-store.mjs';
import { StudioStore, StudioStoreError } from '../../lib/studio/store.mjs';

const PEM = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

test('the token issuer and audience the servers sign are the ones the Convex functions accept', () => {
  const owner = readFileSync(new URL('../../convex/lib/owner.ts', import.meta.url), 'utf8');
  assert.ok(owner.includes(`SERVICE_ISSUER = "${SERVICE_ISSUER}"`), 'convex/lib/owner.ts issuer drifted from lib/convex/constants.mjs');
  assert.ok(owner.includes(`SERVICE_AUDIENCE = "${SERVICE_AUDIENCE}"`), 'convex/lib/owner.ts audience drifted from lib/convex/constants.mjs');
});

test('every public Convex function starts by checking the owner', () => {
  const modules = { library: 10, social: 10, publishing: 1 };
  for (const [file, minimum] of Object.entries(modules)) {
    const source = readFileSync(new URL(`../../convex/${file}.ts`, import.meta.url), 'utf8');
    const registrations = [...source.matchAll(/export const (\w+) = (query|mutation|action)\(/g)].map((match) => match[1]);
    assert.ok(registrations.length >= minimum, `${file}.ts exposes its public functions`);
    for (const name of registrations) {
      const body = source.slice(source.indexOf(`export const ${name} =`));
      const handler = body.slice(0, body.search(/\n}\);\n/) + 4);
      assert.ok(handler.includes('await requireOwner(ctx)'), `${file}.${name} must call requireOwner(ctx)`);
    }
  }
});

test('internal Convex functions are never registered as public ones', () => {
  for (const file of ['socialInternal', 'libraryInternal']) {
    const source = readFileSync(new URL(`../../convex/${file}.ts`, import.meta.url), 'utf8');
    assert.ok(!/= (query|mutation|action)\(/.test(source), `${file}.ts must only register internal functions`);
    assert.ok(/= internal(Query|Mutation)\(/.test(source));
  }
});

test('the Convex settings come from the environment, accept both URL names and both key formats', () => {
  assert.equal(convexSettings({}), null);
  assert.throws(() => convexSettings({ CONVEX_URL: 'http://127.0.0.1:3210' }), /STUDIO_SERVICE_PRIVATE_KEY.*convex:setup/);
  assert.deepEqual(convexSettings({ NEXT_PUBLIC_CONVEX_URL: 'http://a', STUDIO_SERVICE_PRIVATE_KEY: Buffer.from(PEM).toString('base64') }), { url: 'http://a', privateKey: PEM });
  assert.equal(convexSettings({ CONVEX_URL: 'http://b', NEXT_PUBLIC_CONVEX_URL: 'http://a', STUDIO_SERVICE_PRIVATE_KEY: PEM }).privateKey, PEM);
  assert.equal(convexSettings({ CONVEX_URL: 'http://b', NEXT_PUBLIC_CONVEX_URL: 'http://a', STUDIO_SERVICE_PRIVATE_KEY: PEM }).url, 'http://b');
});

test('Convex errors become the errors the web app and MCP tools already handle', () => {
  const studio = translateError(new ConvexError({ code: 'generation_not_found', message: 'Generation not found' }));
  assert.ok(studio instanceof StudioStoreError);
  assert.deepEqual([studio.status, studio.code, studio.message], [404, 'generation_not_found', 'Generation not found']);

  const social = translateError(new ConvexError({ code: 'account_not_found', message: 'Compte introuvable dans ce projet.' }));
  assert.ok(social instanceof SocialError);
  assert.equal(social.status, 404);

  const unauthorized = translateError(new ConvexError({ code: 'unauthorized', message: 'Unauthorized' }));
  assert.equal(unauthorized.status, 500);
  assert.match(unauthorized.message, /convex:setup/);

  const other = new Error('network down');
  assert.equal(translateError(other), other);
  assert.equal(translateError(new ConvexError({ code: 'weird', message: 'x' })).status, 400);
});

test('the studio picks Convex when configured and the files otherwise, and the social store follows', () => {
  const files = createStudioStore({ env: {}, root: '/tmp/pgs-nothing' });
  assert.ok(files instanceof StudioStore);
  assert.ok(getSocialStore(files) instanceof SocialStore);

  const convex = createStudioStore({ env: { CONVEX_URL: 'http://127.0.0.1:3210', STUDIO_SERVICE_PRIVATE_KEY: PEM } });
  assert.ok(convex instanceof ConvexStudioStore);
  assert.equal(convex.backend, 'convex');
  assert.ok(getSocialStore(convex) instanceof ConvexSocialStore);
  assert.equal(getSocialStore(convex), getSocialStore(convex), 'one social store per library');
});
