#!/usr/bin/env node
/**
 * Personal Generative Studio — MCP server (stdio).
 *
 * Exposes the studio's AI Gateway generation engine to MCP clients such as Claude Code.
 * Generated files are written to disk (default: ./generated-media in the client's
 * working directory) so agents can use them directly in the project they work on.
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GenerationError, compatibleModels, loadGatewayCatalog, planGeneration, runGeneration } from '../lib/gateway/engine.mjs';
import { formatEstimate } from '../lib/gateway/estimate.mjs';
import { getModelPriceSummary } from '../lib/gateway/pricing.mjs';
import { MEDIA_TYPE_BY_EXTENSION, saveGeneratedMedia } from '../lib/gateway/media-files.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_TTL_MS = 15 * 60 * 1000;
const MAX_REFERENCE_BYTES = 1_400_000;

export const SERVER_INFO = { name: 'personal-generative-studio', version: '2.0.0' };

/** Loads .env.local / .env from the repository without overriding variables already set. */
export function loadLocalEnv(root = REPO_ROOT, env = process.env) {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(root, fileName);
    if (!existsSync(filePath)) continue;
    for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in env)) env[key] = value;
    }
  }
  return env;
}

export function defaultOutputDir(env = process.env, cwd = process.cwd()) {
  return path.resolve(cwd, env.STUDIO_OUTPUT_DIR || 'generated-media');
}

async function readReferenceImage(filePath, cwd) {
  const resolved = path.resolve(cwd, filePath);
  const extension = path.extname(resolved).slice(1).toLowerCase();
  const mediaType = MEDIA_TYPE_BY_EXTENSION[extension];
  if (!mediaType || !mediaType.startsWith('image/')) {
    throw new GenerationError(`Reference "${filePath}" must be a PNG, JPEG, WebP, GIF or AVIF image`, { code: 'invalid_reference' });
  }
  let bytes;
  try {
    bytes = await readFile(resolved);
  } catch {
    throw new GenerationError(`Reference image not found: ${resolved}`, { code: 'invalid_reference' });
  }
  if (bytes.length > MAX_REFERENCE_BYTES) {
    throw new GenerationError(`Reference image ${filePath} is ${bytes.length} bytes; resize it under ${MAX_REFERENCE_BYTES} bytes first`, { code: 'invalid_reference' });
  }
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof GenerationError && error.details ? `\n${JSON.stringify(error.details, null, 2)}` : '';
  return { isError: true, content: [{ type: 'text', text: `${message}${details}` }] };
}

function modelLine(model) {
  return `- ${model.id} — ${model.name} (${model.provider}) · ${getModelPriceSummary(model)}`;
}

const modalitySchema = z.enum(['image', 'video', 'audio']).describe('image, video or audio (speech)');
const modeSchema = z.enum(['economy', 'balanced', 'quality', 'manual']).optional()
  .describe('Routing strategy when no model is given: economy (cheapest), balanced (default), quality (best). manual requires `model`.');
const modelSchema = z.string().optional().describe('Exact Gateway model id from list_models, e.g. "google/imagen-4.0-generate". Omit for automatic routing.');
const outputDirSchema = z.string().optional().describe('Directory for generated files (absolute, or relative to the current working directory). Defaults to STUDIO_OUTPUT_DIR or ./generated-media.');

/**
 * Builds the MCP server. Dependencies are injectable so tests never call a provider.
 */
export function createStudioServer({
  loadCatalog = loadGatewayCatalog,
  generators,
  outputDir,
  cwd = process.cwd(),
  env = process.env,
  now = () => new Date(),
} = {}) {
  const server = new McpServer(SERVER_INFO, {
    instructions: [
      'Personal Generative Studio generates images, videos and speech through Vercel AI Gateway and saves the files to disk.',
      'Call list_models to discover model ids and prices, estimate_cost to preview spending, then generate_image, generate_video or generate_speech.',
      'Every generation returns the absolute file paths written; read or reuse them directly.',
    ].join(' '),
  });

  let catalogCache = null;
  async function getCatalog() {
    if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.models;
    const models = await loadCatalog();
    catalogCache = { models, expiresAt: Date.now() + CATALOG_TTL_MS };
    return models;
  }

  function resolveOutputDir(requested) {
    return requested ? path.resolve(cwd, requested) : (outputDir || defaultOutputDir(env, cwd));
  }

  async function runAndSave(rawInput, requestedOutputDir) {
    const catalog = await getCatalog();
    const plan = planGeneration(catalog, rawInput);
    const result = await runGeneration(plan, { generators, tags: ['surface:mcp'] });
    const saved = await saveGeneratedMedia({
      outputDir: resolveOutputDir(requestedOutputDir),
      modality: plan.input.modality,
      prompt: plan.input.prompt,
      media: result.media,
      now: now(),
      manifest: {
        model: { id: result.model.id, name: result.model.name, provider: result.model.provider },
        request: { ...plan.input, referenceImages: plan.input.referenceImages.length },
        estimate: result.estimate,
        warnings: result.warnings,
      },
    });
    const lines = [
      `Generated ${saved.files.length} ${plan.input.modality} file(s) with ${result.model.id}.`,
      ...saved.files.map((file) => `- ${file.path} (${file.mediaType}, ${file.bytes} bytes)`),
      `Manifest: ${saved.manifestPath}`,
      `Estimated cost: ${formatEstimate(result.estimate)}`,
    ];
    if (result.warnings?.length) lines.push(`Warnings: ${result.warnings.map((warning) => warning.message || warning.type || JSON.stringify(warning)).join('; ')}`);
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        model: result.model.id,
        files: saved.files.map((file) => file.path),
        manifest: saved.manifestPath,
        estimate: result.estimate,
        warnings: result.warnings,
      },
    };
  }

  server.registerTool('list_models', {
    title: 'List Gateway models',
    description: 'Lists the image, video and speech models currently available through Vercel AI Gateway, with live prices. Use the returned ids with the generate_* tools.',
    inputSchema: {
      modality: modalitySchema.optional(),
      search: z.string().optional().describe('Case-insensitive filter on the model id, name or provider'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum number of models to return (default 60)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ modality, search, limit = 60 }) => {
    try {
      const catalog = await getCatalog();
      const modalities = modality ? [modality] : ['image', 'video', 'audio'];
      const needle = search?.trim().toLowerCase();
      const sections = modalities.map((item) => {
        const models = compatibleModels(catalog, item)
          .filter((model) => !needle || `${model.id} ${model.name} ${model.provider}`.toLowerCase().includes(needle))
          .slice(0, limit);
        return { modality: item, models };
      });
      const text = sections.map(({ modality: item, models }) => `## ${item} (${models.length})\n${models.length ? models.map(modelLine).join('\n') : '- none'}`).join('\n\n');
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          models: sections.flatMap(({ modality: item, models }) => models.map((model) => ({
            id: model.id, name: model.name, provider: model.provider, modality: item, price: getModelPriceSummary(model),
          }))),
        },
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('estimate_cost', {
    title: 'Estimate generation cost',
    description: 'Resolves which model would be used and estimates the cost in USD without generating anything.',
    inputSchema: {
      modality: modalitySchema,
      prompt: z.string().min(1).describe('The prompt (or the text to speak for audio)'),
      model: modelSchema,
      mode: modeSchema,
      duration: z.number().int().min(1).max(30).optional().describe('Video duration in seconds'),
      count: z.number().int().min(1).max(4).optional().describe('Number of outputs'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (args) => {
    try {
      const plan = planGeneration(await getCatalog(), args);
      return {
        content: [{ type: 'text', text: `${plan.model.id} — ${formatEstimate(plan.estimate)}` }],
        structuredContent: { model: plan.model.id, estimate: plan.estimate },
      };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('generate_image', {
    title: 'Generate image',
    description: 'Generates one or more images from a prompt (optionally guided by reference images) and writes them to disk. Returns the file paths.',
    inputSchema: {
      prompt: z.string().min(1).max(8000).describe('Detailed description of the image'),
      model: modelSchema,
      mode: modeSchema,
      aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional().describe('e.g. 1:1, 16:9, 9:16'),
      size: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional().describe('Explicit pixel size such as 1024x1024 (model dependent)'),
      seed: z.number().int().optional(),
      count: z.number().int().min(1).max(4).optional().describe('Number of images (default 1)'),
      referenceImages: z.array(z.string()).max(3).optional().describe('Up to 3 local image paths used as references (image-to-image, style or character continuity)'),
      outputDir: outputDirSchema,
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async ({ referenceImages = [], outputDir: requestedOutputDir, ...args }) => {
    try {
      const references = await Promise.all(referenceImages.map((file) => readReferenceImage(file, cwd)));
      return await runAndSave({ modality: 'image', ...args, referenceImages: references }, requestedOutputDir);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('generate_video', {
    title: 'Generate video',
    description: 'Generates a video from a prompt (text-to-video) or from a reference image (image-to-video) and writes it to disk. Video generations can take several minutes.',
    inputSchema: {
      prompt: z.string().min(1).max(8000).describe('Scene, motion and camera description'),
      model: modelSchema,
      mode: modeSchema,
      aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional().describe('e.g. 16:9, 9:16'),
      resolution: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional().describe('e.g. 1280x720 (model dependent)'),
      duration: z.number().int().min(1).max(30).optional().describe('Duration in seconds (model dependent)'),
      seed: z.number().int().optional(),
      generateAudio: z.boolean().optional().describe('Ask the model for native audio when supported'),
      referenceImage: z.string().optional().describe('Local image path used as the first frame / reference'),
      outputDir: outputDirSchema,
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async ({ referenceImage, outputDir: requestedOutputDir, ...args }) => {
    try {
      const references = referenceImage ? [await readReferenceImage(referenceImage, cwd)] : [];
      return await runAndSave({ modality: 'video', ...args, referenceImages: references }, requestedOutputDir);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('generate_speech', {
    title: 'Generate speech',
    description: 'Converts text to speech with a Gateway speech model and writes the audio file to disk.',
    inputSchema: {
      text: z.string().min(1).max(8000).describe('Text to speak'),
      model: modelSchema,
      mode: modeSchema,
      voice: z.string().max(80).optional().describe('Voice name supported by the model (default alloy)'),
      outputFormat: z.string().max(20).optional().describe('mp3, wav… when the model supports it'),
      outputDir: outputDirSchema,
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async ({ text, outputDir: requestedOutputDir, ...args }) => {
    try {
      return await runAndSave({ modality: 'audio', prompt: text, ...args }, requestedOutputDir);
    } catch (error) {
      return errorResult(error);
    }
  });

  return server;
}

export async function main() {
  loadLocalEnv();
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    console.error('[personal-generative-studio] AI_GATEWAY_API_KEY is not set; generation calls will fail until it is configured.');
  }
  const server = createStudioServer();
  await server.connect(new StdioServerTransport());
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
