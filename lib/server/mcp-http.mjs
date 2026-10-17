import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { MEDIA_TYPE_BY_EXTENSION, buildMediaBaseName, extensionFor, saveGeneratedMedia } from '../gateway/media-files.mjs';
import { createStudioServer } from '../../mcp/server.mjs';

export const MIN_TOKEN_LENGTH = 24;

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  return timingSafeEqual(digest(expected), digest(provided));
}

/** Reads the secret from `Authorization: Bearer <token>` or, for clients that cannot send headers, from the URL path. */
export function extractToken(authorizationHeader, pathToken) {
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader || '');
  if (match) return match[1].trim();
  if (!pathToken) return '';
  try {
    return decodeURIComponent(pathToken);
  } catch {
    return '';
  }
}

export function isValidAuthToken(token) {
  return typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH;
}

function jsonRpcResponse(status, message, headers = {}) {
  return Response.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, { status, headers });
}

/**
 * Publisher for hosts with a persistent disk: each generation lands in its own unguessable directory
 * under `filesRoot` and is reachable at `<publicBaseUrl>/files/<id>/<name>`.
 */
export function createDiskPublisher({ filesRoot, publicBaseUrl }) {
  const root = path.resolve(filesRoot);
  const base = publicBaseUrl.replace(/\/+$/, '');
  const urlFor = (filePath) => `${base}/files/${path.relative(root, filePath).split(path.sep).map(encodeURIComponent).join('/')}`;
  return async function publish(options) {
    const saved = await saveGeneratedMedia({ ...options, outputDir: path.join(root, randomBytes(16).toString('hex')) });
    return {
      files: saved.files.map((file) => ({ url: urlFor(file.path), mediaType: file.mediaType, bytes: file.bytes })),
      manifestUrl: urlFor(saved.manifestPath),
    };
  };
}

/** Reads back a file this disk publisher issued a link for (publish_to_social imports it); null for any other link. */
export function createDiskReader({ filesRoot, publicBaseUrl }) {
  const root = path.resolve(filesRoot);
  const prefix = `${publicBaseUrl.replace(/\/+$/, '')}/files/`;
  return async function fetchOwn(url) {
    if (!String(url).startsWith(prefix)) return null;
    let relative;
    try { relative = decodeURIComponent(String(url).slice(prefix.length).split(/[?#]/)[0]); } catch { return null; }
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(`${root}${path.sep}`)) return null;
    try {
      return { bytes: await readFile(filePath), mediaType: MEDIA_TYPE_BY_EXTENSION[path.extname(filePath).slice(1).toLowerCase()] };
    } catch {
      return null;
    }
  };
}

/** Downloads a link on Vercel Blob's public domain (where the Blob publisher stores files); null for any other host. */
export async function fetchBlobUrl(url, fetchImpl = fetch) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) return null;
  const response = await fetchImpl(parsed, { redirect: 'error' });
  if (!response.ok) return null;
  return { bytes: Buffer.from(await response.arrayBuffer()), mediaType: response.headers.get('content-type') || undefined };
}

/**
 * Publisher for serverless hosts (Vercel): uploads to a public Vercel Blob store. Blob appends a random
 * suffix to every pathname, so the returned URLs cannot be guessed.
 */
export function createBlobPublisher({ token, put } = {}) {
  async function upload(pathname, bytes, contentType) {
    const putBlob = put || (await import('@vercel/blob')).put;
    const blob = await putBlob(pathname, bytes, { access: 'public', addRandomSuffix: true, contentType, ...(token ? { token } : {}) });
    return blob.url;
  }
  return async function publish({ modality, prompt, media, manifest = {}, now = new Date() }) {
    const baseName = buildMediaBaseName({ modality, prompt, now });
    const files = [];
    for (const [index, item] of media.entries()) {
      const suffix = media.length > 1 ? `-${index + 1}` : '';
      const bytes = item.uint8Array ? Buffer.from(item.uint8Array) : Buffer.from(item.base64 || '', 'base64');
      const url = await upload(`mcp/${baseName}${suffix}.${extensionFor(item.mediaType, modality)}`, bytes, item.mediaType);
      files.push({ url, mediaType: item.mediaType, bytes: bytes.length });
    }
    const manifestBody = `${JSON.stringify({ createdAt: now.toISOString(), modality, prompt, ...manifest, files }, null, 2)}\n`;
    const manifestUrl = await upload(`mcp/${baseName}.json`, Buffer.from(manifestBody), 'application/json');
    return { files, manifestUrl };
  };
}

/**
 * Handles one MCP request in a stateless way (web-standard Request/Response), for serverless routes.
 * `serverOptions` are forwarded to `createStudioServer`; the caller supplies `remote` and, usually, `store`.
 */
export async function handleMcpRequest(request, { authToken, pathToken, createServer = createStudioServer, ...serverOptions }) {
  if (!isValidAuthToken(authToken)) return jsonRpcResponse(503, `MCP_AUTH_TOKEN must be set and at least ${MIN_TOKEN_LENGTH} characters long`);
  if (!tokensMatch(authToken, extractToken(request.headers.get('authorization'), pathToken))) {
    return jsonRpcResponse(401, 'Unauthorized', { 'www-authenticate': 'Bearer' });
  }
  if (request.method !== 'POST') return jsonRpcResponse(405, 'Method not allowed: this server is stateless, use POST', { allow: 'POST' });

  const server = createServer(serverOptions);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}
