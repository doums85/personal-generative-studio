# Personal Generative Studio

A private, single-user creative AI workspace for images, video, speech, music, cinema, lip-sync, marketing, agents, and visual workflows.

This repository is a personal fork of [Open Generative AI](https://github.com/anil-matcha/open-generative-ai). It keeps the upstream MIT license and attribution while replacing the public MuAPI key flow with a server-side architecture centered on [Vercel AI Gateway](https://vercel.com/ai-gateway).

## Current foundation

- Google sign-in restricted to an exact server-side email allowlist.
- Server-side AI Gateway credentials; no provider key is stored in the browser.
- Dynamic image, video, speech, transcription, and language model discovery.
- Manual, Economy, Balanced, and Maximum Quality routing foundations.
- Gateway-native Image, Video, and Audio studio surfaces.
- A private creative library for reusable characters, places, objects, products, and visual styles, with imported or AI-generated references.
- Live, unit-aware Gateway prices in model selectors.
- The complete upstream studio shell remains available for phased migration of advanced tools.
- Security headers, protected API routes, unit tests, linting, and a verified production build.
- A stdio MCP server so Claude Code and other agents can generate media straight into their projects.
- Pre-flight cost estimates and a per-generation budget limit shared by the web app and the MCP server.

See the approved [design specification](docs/superpowers/specs/2026-09-12-personal-generative-studio-design.md) and [implementation plan](docs/superpowers/plans/2026-09-12-personal-generative-studio-implementation.md).

## Local setup

Requirements: Node.js 20 or newer and npm.

```bash
git clone --recurse-submodules https://github.com/doums85/personal-generative-studio.git
cd personal-generative-studio
cp .env.example .env.local
npm ci --ignore-scripts
npm run build:packages
npm run dev
```

Fill these values in `.env.local`:

- `AUTH_SECRET`: generate with `npx auth secret`.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: Google OAuth credentials.
- `ALLOWED_EMAILS`: exact comma-separated Google addresses allowed to enter.
- `AI_GATEWAY_API_KEY`: a Vercel AI Gateway key. Vercel OIDC may be used on linked deployments.
- `STUDIO_PUBLIC_URL` (deployments only): public address used to serve reference media to URL-only video models.

Google OAuth callback URLs:

- local: `http://localhost:3000/api/auth/callback/google`
- production: `https://YOUR_DOMAIN/api/auth/callback/google`

## Verification

```bash
npm test
npm run lint
npm run build:packages
npm run build
```

The default automated tests never make paid model calls.

## Workspaces, references and the gallery

The studio is organised like a production tool:

- **Workspaces** (one per project) hold their own references, gallery and art direction. The art direction (`Direction artistique du projet`) is appended to every image and video prompt of the project.
- **References** (`Références`) are the project's reference database: avatars (a person with reference images, a description and a voice), characters, places (the kitchen of a cooking channel, a shop…), objects, products, visual styles and any other reference image (moodboard, plan, logo). Each entry carries several images (uploaded or generated as a character/location sheet) and a description. Mention it with `@Name` in any prompt, or pick it in the composer: its description is added as a continuity block and its main image is sent as a reference to models that accept one (GPT Image, FLUX Kontext / FLUX.2, Seedream, Grok Imagine, Wan, Seedance, Veo 3.1, Kling 3.0…).
- **Video Studio with synchronized dialogue**: switch on `Dialogue synchronisé`, write what is said and choose who speaks. *Voix synthétisée + synchro* generates the voice with a speech model (OpenAI TTS, Gemini TTS, Fish Audio, Grok TTS) using the speaker's default voice, then feeds the track to a video model that accepts an audio reference (Seedance 2.0, Wan 2.6/2.7/3.0, MiniMax H3, Grok Imagine 1.5) so lips and pauses follow the voice; the clip duration is fitted to the speech. *Voix native du modèle* asks a video model with native audio (Veo 3, Kling, Grok Imagine, Seedance 1.5…) to speak the script itself. The speaker's portrait becomes the first frame when no start image is chosen, and both the video and the voice track are kept in the gallery.
- **Gallery**: every generation is stored with its prompt, model, parameters, dialogue, warnings and estimated cost. From a result you can animate an image into a video, make a variation, save it as a reference or turn it into an avatar.
- **Voix off**: text-to-speech playground; the chosen voice can be saved on an avatar.

Everything lives on disk under `STUDIO_DATA_DIR` (default `./data`, ignored by git): `workspaces.json`, then `workspaces/<id>/elements.json`, `generations.json` and `media/`. Back this folder up to keep your projects; on Vercel the filesystem is ephemeral, so self-host (Docker) or mount persistent storage for a durable library.

### Public media links

Several video providers only accept `url` inputs for images and audio (the catalog publishes this per model). When `STUDIO_PUBLIC_URL` points to the public address of the deployment, the studio serves those files through signed links (`/api/studio/public/<token>/…`, HMAC signed with `STUDIO_MEDIA_SECRET` or `AUTH_SECRET`). Without it, the studio refuses those combinations before any paid call and suggests a model that accepts base64 inputs or the native-voice method.

The advanced upstream studios (Layers, Cinema, Clipping, Motion Control, Marketing, Workflows, Agents, Design Agent) remain available from the sidebar and still use the MuAPI key.

## Claude Code and other MCP clients

The studio ships an MCP server (`mcp/server.mjs`, stdio transport) that exposes the same AI Gateway generation engine as the web app. Agents such as Claude Code can discover models, estimate costs and generate images, videos and speech; every output is written to disk in the project the agent is working on.

Tools: `list_models`, `estimate_cost`, `generate_image`, `generate_video`, `generate_speech`, plus `list_workspaces` and `list_elements` to reuse the studio references: pass `elements: ["Maya", "Cuisine"]` (names or ids) with a `workspace` to inject the same reference images and continuity descriptions as the web app, and `dialogue` on `generate_video` to get a clip whose lips are synchronized to the spoken text (native-audio models).

Inside this repository, the checked-in `.mcp.json` registers the server automatically for Claude Code. To use the studio from any other project, register it once at user scope:

```bash
claude mcp add --scope user studio -- node /absolute/path/to/personal-generative-studio/mcp/server.mjs
```

Configuration:

- `AI_GATEWAY_API_KEY` is read from the environment, then from this repository's `.env.local`.
- `MAX_GENERATION_COST_USD` rejects any generation whose estimated cost exceeds the limit.
- `STUDIO_OUTPUT_DIR` (or the `outputDir` tool argument) chooses where files are written; the default is `./generated-media` in the client's working directory.
- `STUDIO_DATA_DIR` points to the studio library shared with the web app (default `./data` in this repository).

Each generation writes the media files plus a JSON manifest (prompt, model, estimate, warnings) next to them, so a project keeps its own history of generated assets.

## Deployment

Deploy the Next.js application to Vercel, configure the environment variables above, and enable AI Gateway for the linked project. Long video generations use a five-minute function duration and therefore require a compatible Vercel plan and model. Set `STUDIO_PUBLIC_URL` to the deployment address so URL-only video models can fetch reference images and voice tracks.

The studio library (`STUDIO_DATA_DIR`) is written to the local filesystem. On Vercel this storage is ephemeral: use the Docker image or another host with a persistent volume for a durable library, or mount the data directory on shared storage. Private Blob storage and a Postgres database remain the future option for multi-region deployments.

## Migration status

Image, Video, and speech generation use the new Gateway surface. Advanced upstream studios are retained while their MuAPI-specific calls are migrated to the shared job contract. Consult the implementation plan for the ordered milestones.

## License and attribution

MIT licensed. Copyright and attribution from the upstream Open Generative AI project remain in [LICENSE](LICENSE). New fork-specific work is provided under the same license.
