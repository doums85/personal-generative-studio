import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { normalizeGatewayCatalog } from '../../lib/gateway/catalog.mjs';
import { buildMediaBaseName, extensionFor, slugify } from '../../lib/gateway/media-files.mjs';
import { createStudioServer, defaultOutputDir, loadLocalEnv } from '../../mcp/server.mjs';

const catalog = normalizeGatewayCatalog({ data: [
  { id: 'lab/image-pro', name: 'Image Pro', type: 'image', owned_by: 'lab', pricing: { image: '0.08' } },
  { id: 'lab/image-fast', name: 'Image Fast', type: 'image', owned_by: 'lab', pricing: { image: '0.01' } },
  { id: 'lab/video-pro', name: 'Video Pro', type: 'video', owned_by: 'lab', pricing: { second: '0.05' } },
  { id: 'lab/speech-fast', name: 'Speech Fast', type: 'speech', owned_by: 'lab', pricing: { speech_input_character_cost: '0.00001' } },
] });

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function fakeGenerators(calls) {
  return {
    image: async (args) => { calls.push(args); return { media: [{ mediaType: 'image/png', base64: PNG_BASE64 }], warnings: [] }; },
    video: async (args) => { calls.push(args); return { media: [{ mediaType: 'video/mp4', uint8Array: new Uint8Array([0, 1, 2]) }], warnings: [] }; },
    audio: async (args) => { calls.push(args); return { media: [{ mediaType: 'audio/mpeg', base64: Buffer.from('audio').toString('base64') }], warnings: [] }; },
  };
}

async function connect(options) {
  const server = createStudioServer(options);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('media file names are stable, safe and typed', () => {
  assert.equal(slugify('Un phare breton, à l’aube !'), 'un-phare-breton-a-l-aube');
  assert.equal(slugify(''), 'media');
  assert.equal(extensionFor('image/jpeg; charset=binary', 'image'), 'jpg');
  assert.equal(extensionFor('application/octet-stream', 'video'), 'mp4');
  assert.equal(buildMediaBaseName({ modality: 'image', prompt: 'Hello World', now: new Date(2026, 8, 27, 9, 5, 7) }), '20260927-090507-image-hello-world');
});

test('local env loading fills missing variables only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pgs-env-'));
  await writeFile(path.join(root, '.env.local'), '# comment\nAI_GATEWAY_API_KEY="vck_test"\nSTUDIO_OUTPUT_DIR=media\nEMPTY=\n');
  const env = { STUDIO_OUTPUT_DIR: 'keep' };
  loadLocalEnv(root, env);
  assert.equal(env.AI_GATEWAY_API_KEY, 'vck_test');
  assert.equal(env.STUDIO_OUTPUT_DIR, 'keep');
  assert.equal(env.EMPTY, '');
  assert.equal(defaultOutputDir({}, '/work/project'), path.resolve('/work/project/generated-media'));
  assert.equal(defaultOutputDir({ STUDIO_OUTPUT_DIR: '/media' }, '/work/project'), path.resolve('/media'));
  await rm(root, { recursive: true, force: true });
});

test('the MCP server exposes discovery, estimation and generation tools', async () => {
  const calls = [];
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'pgs-out-'));
  const { client, close } = await connect({
    loadCatalog: async () => catalog,
    generators: fakeGenerators(calls),
    outputDir,
    now: () => new Date(2026, 8, 27, 12, 0, 0),
  });

  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['estimate_cost', 'generate_image', 'generate_speech', 'generate_video', 'list_models']);

    const listed = await client.callTool({ name: 'list_models', arguments: { modality: 'image', search: 'fast' } });
    assert.equal(listed.isError, undefined);
    assert.match(listed.content[0].text, /lab\/image-fast/);
    assert.doesNotMatch(listed.content[0].text, /image-pro/);
    assert.equal(listed.structuredContent.models.length, 1);

    const estimate = await client.callTool({ name: 'estimate_cost', arguments: { modality: 'video', prompt: 'Vagues', duration: 10 } });
    assert.equal(estimate.structuredContent.model, 'lab/video-pro');
    assert.equal(estimate.structuredContent.estimate.amount, 0.5);

    const image = await client.callTool({ name: 'generate_image', arguments: { prompt: 'Un phare breton', mode: 'economy', aspectRatio: '16:9' } });
    assert.equal(image.isError, undefined, image.content?.[0]?.text);
    assert.equal(image.structuredContent.model, 'lab/image-fast');
    assert.equal(image.structuredContent.files.length, 1);
    assert.match(image.structuredContent.files[0], /20260927-120000-image-un-phare-breton\.png$/);
    assert.equal(calls.at(-1).aspectRatio, '16:9');
    assert.deepEqual(calls.at(-1).providerOptions.gateway.tags, ['app:personal-studio', 'modality:image', 'surface:mcp']);
    const bytes = await readFile(image.structuredContent.files[0]);
    assert.equal(bytes.toString('base64'), PNG_BASE64);
    const manifest = JSON.parse(await readFile(image.structuredContent.manifest, 'utf8'));
    assert.equal(manifest.model.id, 'lab/image-fast');
    assert.equal(manifest.request.prompt, 'Un phare breton');

    const speech = await client.callTool({ name: 'generate_speech', arguments: { text: 'Bonjour', voice: 'nova', outputDir: path.join(outputDir, 'voix') } });
    assert.equal(speech.isError, undefined, speech.content?.[0]?.text);
    assert.match(speech.structuredContent.files[0], /voix[\\/]20260927-120000-audio-bonjour\.mp3$/);
    assert.equal(calls.at(-1).voice, 'nova');
    assert.equal(calls.at(-1).prompt, 'Bonjour');

    const video = await client.callTool({ name: 'generate_video', arguments: { prompt: 'Vagues', referenceImage: image.structuredContent.files[0], duration: 4 } });
    assert.equal(video.isError, undefined, video.content?.[0]?.text);
    assert.match(calls.at(-1).referenceImages[0], /^data:image\/png;base64,/);
    assert.match(video.structuredContent.files[0], /\.mp4$/);

    const failed = await client.callTool({ name: 'generate_image', arguments: { prompt: 'x', model: 'lab/missing' } });
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /not available/);

    const badReference = await client.callTool({ name: 'generate_image', arguments: { prompt: 'x', referenceImages: ['/nope/missing.png'] } });
    assert.equal(badReference.isError, true);
    assert.match(badReference.content[0].text, /not found/);
    assert.equal(calls.length, 3);

    const written = await readdir(outputDir);
    assert.equal(written.filter((name) => name.endsWith('.json')).length, 2);
  } finally {
    await close();
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('catalog failures surface as tool errors instead of crashing the server', async () => {
  const { client, close } = await connect({ loadCatalog: async () => { throw new Error('Gateway catalog unreachable: blocked'); }, generators: fakeGenerators([]) });
  try {
    const result = await client.callTool({ name: 'list_models', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unreachable/);
  } finally {
    await close();
  }
});
