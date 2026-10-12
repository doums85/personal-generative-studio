#!/usr/bin/env node
/**
 * Personal Generative Studio — MCP server (Streamable HTTP).
 *
 * Hosted counterpart of mcp/server.mjs for remote clients such as Claude Cloud connectors:
 *   POST /mcp                 MCP endpoint (stateless), authenticated with MCP_AUTH_TOKEN
 *   POST /mcp/<token>         same endpoint with the token in the path, for clients that cannot send headers
 *   GET  /files/<id>/<name>   generated media, reachable only through the unguessable <id> returned by the tools
 *   GET  /health              liveness probe
 */
import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadGatewayCatalog } from '../lib/gateway/engine.mjs';
import { MEDIA_TYPE_BY_EXTENSION } from '../lib/gateway/media-files.mjs';
import { MIN_TOKEN_LENGTH, createDiskPublisher, extractToken, isValidAuthToken, tokensMatch } from '../lib/server/mcp-http.mjs';
import { createStudioServer, loadLocalEnv } from './server.mjs';

export { tokensMatch };

const CATALOG_TTL_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const FILE_ROUTE = /^\/files\/([a-f0-9]{32})\/([A-Za-z0-9._-]+)$/;
const MCP_ROUTE = /^\/mcp(?:\/([^/]+))?$/;

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res, status, message, headers) {
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null }, headers);
}

/**
 * Builds the HTTP request listener. `loadCatalog` and `createServer` are injectable for tests.
 */
export function createHttpHandler({
  authToken,
  filesRoot,
  publicBaseUrl,
  loadCatalog = loadGatewayCatalog,
  createServer = createStudioServer,
  env = process.env,
}) {
  if (!isValidAuthToken(authToken)) {
    throw new Error(`MCP_AUTH_TOKEN must be set and at least ${MIN_TOKEN_LENGTH} characters long`);
  }
  const root = path.resolve(filesRoot);
  const remote = { publish: createDiskPublisher({ filesRoot: root, publicBaseUrl }) };

  let catalogCache = null;
  async function sharedCatalog() {
    if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.models;
    const models = await loadCatalog();
    catalogCache = { models, expiresAt: Date.now() + CATALOG_TTL_MS };
    return models;
  }

  async function serveFile(req, res, id, name) {
    const filePath = path.join(root, id, name);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return sendJson(res, 404, { error: 'not_found' });
    }
    if (!info.isFile()) return sendJson(res, 404, { error: 'not_found' });
    const extension = path.extname(name).slice(1).toLowerCase();
    res.writeHead(200, {
      'content-type': extension === 'json' ? 'application/json' : MEDIA_TYPE_BY_EXTENSION[extension] || 'application/octet-stream',
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  }

  async function serveMcp(req, res) {
    if (req.method !== 'POST') {
      return jsonRpcError(res, 405, 'Method not allowed: this server is stateless, use POST', { allow: 'POST' });
    }
    if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) {
      return jsonRpcError(res, 413, 'Request body too large');
    }
    const server = createServer({ loadCatalog: sharedCatalog, remote, env });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return async function handler(req, res) {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/health') return sendJson(res, 200, { status: 'ok' });

      const fileMatch = FILE_ROUTE.exec(pathname);
      if (fileMatch && (req.method === 'GET' || req.method === 'HEAD')) return await serveFile(req, res, fileMatch[1], fileMatch[2]);

      const mcpMatch = MCP_ROUTE.exec(pathname);
      if (mcpMatch) {
        if (!tokensMatch(authToken, extractToken(req.headers.authorization, mcpMatch[1]))) {
          return jsonRpcError(res, 401, 'Unauthorized', { 'www-authenticate': 'Bearer' });
        }
        return await serveMcp(req, res);
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      console.error('[personal-generative-studio] request failed:', error instanceof Error ? error.message : error);
      if (!res.headersSent) return jsonRpcError(res, 500, 'Internal server error');
      res.end();
    }
  };
}

export async function main() {
  loadLocalEnv();
  const env = process.env;
  const port = Number(env.PORT || env.MCP_PORT || 3333);
  const handler = createHttpHandler({
    authToken: env.MCP_AUTH_TOKEN,
    filesRoot: env.MCP_FILES_DIR || 'generated-media',
    publicBaseUrl: env.MCP_PUBLIC_URL || env.STUDIO_PUBLIC_URL || `http://localhost:${port}`,
    env,
  });
  if (!env.AI_GATEWAY_API_KEY && !env.VERCEL_OIDC_TOKEN) {
    console.error('[personal-generative-studio] AI_GATEWAY_API_KEY is not set; generation calls will fail until it is configured.');
  }
  http.createServer(handler).listen(port, () => {
    console.error(`[personal-generative-studio] MCP HTTP server listening on :${port} (endpoint /mcp)`);
  });
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
}
if (isEntrypoint()) {
  main().catch((error) => {
    console.error('[personal-generative-studio] fatal:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
