import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { normalizeGatewayCatalog } from '../../lib/gateway/catalog.mjs';
import { createHttpHandler, tokensMatch } from '../../mcp/http.mjs';
import { createBlobPublisher, extractToken, handleMcpRequest } from '../../lib/server/mcp-http.mjs';
import { createStudioServer } from '../../mcp/server.mjs';
import { StudioStore } from '../../lib/studio/store.mjs';

const TOKEN = 'test-token-0123456789-abcdefghij';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const catalog = normalizeGatewayCatalog({ data: [
  { id: 'lab/image-fast', name: 'Image Fast', type: 'image', owned_by: 'lab', pricing: { image: '0.01' } },
] });

async function startServer() {
  const filesRoot = await mkdtemp(path.join(os.tmpdir(), 'pgs-http-'));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'pgs-data-'));
  const generators = { image: async () => ({ media: [{ mediaType: 'image/png', base64: PNG_BASE64 }], warnings: [] }) };
  const handler = createHttpHandler({
    authToken: TOKEN,
    filesRoot,
    publicBaseUrl: 'http://placeholder',
    loadCatalog: async () => catalog,
    createServer: (options) => createStudioServer({ ...options, generators, store: new StudioStore({ rootDir: dataRoot }) }),
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(filesRoot, { recursive: true, force: true });
      await rm(dataRoot, { recursive: true, force: true });
    },
  };
}

test('token comparison is exact and rejects empty values', () => {
  assert.equal(tokensMatch(TOKEN, TOKEN), true);
  assert.equal(tokensMatch(TOKEN, `${TOKEN}x`), false);
  assert.equal(tokensMatch(TOKEN, ''), false);
  assert.equal(tokensMatch('', ''), false);
});

test('the HTTP handler refuses weak tokens', () => {
  assert.throws(() => createHttpHandler({ authToken: 'short', filesRoot: '.', publicBaseUrl: 'http://x' }), /MCP_AUTH_TOKEN/);
});

test('the HTTP endpoint authenticates, serves tools and hosts generated files', async () => {
  const { base, close } = await startServer();
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: 'Bearer wrong-token-wrong-token-wrong' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 405);
    assert.equal((await fetch(`${base}/nope`)).status, 404);

    for (const [endpoint, requestInit] of [
      [`${base}/mcp`, { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }],
      [`${base}/mcp/${TOKEN}`, {}],
    ]) {
      const client = new Client({ name: 'http-test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), requestInit));
      const { tools } = await client.listTools();
      const generateImage = tools.find((tool) => tool.name === 'generate_image');
      assert.ok(generateImage);
      assert.equal('outputDir' in generateImage.inputSchema.properties, false);
      assert.equal('referenceImages' in generateImage.inputSchema.properties, false);

      const result = await client.callTool({ name: 'generate_image', arguments: { prompt: 'Un phare breton' } });
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      const [url] = result.structuredContent.files;
      assert.match(url, /^http:\/\/placeholder\/files\/[a-f0-9]{32}\/.+-image-un-phare-breton\.png$/);

      const download = await fetch(url.replace('http://placeholder', base));
      assert.equal(download.status, 200);
      assert.equal(download.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await download.arrayBuffer()).toString('base64'), PNG_BASE64);
      await client.close();
    }

    assert.equal((await fetch(`${base}/files/${'0'.repeat(32)}/missing.png`)).status, 404);
    assert.equal((await fetch(`${base}/files/..%2F..%2Fetc/passwd`)).status, 404);
  } finally {
    await close();
  }
});

test('tokens come from the Bearer header first, then from the URL path', () => {
  assert.equal(extractToken('Bearer abc', 'path'), 'abc');
  assert.equal(extractToken('', 'p%40th'), 'p@th');
  assert.equal(extractToken(null, undefined), '');
  assert.equal(extractToken('', '%E0%A4%A'), '');
});

test('the serverless handler is stateless, authenticated and publishes media to Blob', async () => {
  const uploads = [];
  const put = async (pathname, body, options) => {
    uploads.push({ pathname, bytes: body.length, options });
    return { url: `https://blob.example/${pathname}` };
  };
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'pgs-data-'));
  const generators = { image: async () => ({ media: [{ mediaType: 'image/png', base64: PNG_BASE64 }], warnings: [] }) };
  const options = {
    authToken: TOKEN,
    remote: { publish: createBlobPublisher({ put }) },
    loadCatalog: async () => catalog,
    generators,
    store: new StudioStore({ rootDir: dataRoot }),
  };
  const call = (body, init = {}) => handleMcpRequest(new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...init.headers },
    body: JSON.stringify(body),
  }), { ...options, ...init.options });

  try {
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'Un phare breton' } } };
    assert.equal((await call(rpc)).status, 401);
    assert.equal((await call(rpc, { options: { authToken: 'short' } })).status, 503);
    assert.equal((await handleMcpRequest(new Request('http://localhost/api/mcp', { headers: { authorization: `Bearer ${TOKEN}` } }), options)).status, 405);

    const response = await call(rpc, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /https:\/\/blob\.example\/mcp\/.+-image-un-phare-breton\.png/);
    assert.deepEqual(uploads.map((upload) => upload.options.contentType), ['image/png', 'application/json']);
    assert.ok(uploads.every((upload) => upload.options.access === 'public' && upload.options.addRandomSuffix === true));

    const viaPath = await call(rpc, { options: { pathToken: TOKEN } });
    assert.equal(viaPath.status, 200);
    await viaPath.text();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
