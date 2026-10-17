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
- `AUTH_PASSWORD_HASH`: scrypt hash of the owner's password. Run `node scripts/hash-password.mjs` to print a random password and its hash (or `node scripts/hash-password.mjs 'your password'` to hash your own); keep the password, store only the hash.
- `ALLOWED_EMAILS`: the address allowed to sign in (a single owner address; comma-separated values are also accepted).
- `AI_GATEWAY_API_KEY`: a Vercel AI Gateway key. Vercel OIDC may be used on linked deployments.
- `STUDIO_PUBLIC_URL` (deployments only): public address used to serve reference media to URL-only video models.

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

### Publishing to social networks

Each workspace has its own connected accounts: open **Réseaux sociaux** in the sidebar to connect them, then open any image or video in the gallery and choose **Publier**. A project only ever publishes to the accounts connected to it, and deleting a project forgets its accounts.

| Network | What is published | Credentials |
| --- | --- | --- |
| Facebook Pages | photo or video on the Page | `META_APP_ID`, `META_APP_SECRET` |
| Instagram (professional account linked to a Page) | feed image, or Reel for videos | same Meta app |
| TikTok | video or photo, published directly or sent to the TikTok app as a draft | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |

Setup, once per network:

1. **Meta** (developers.facebook.com): create an app with *Facebook Login*, add the redirect URI shown on the *Réseaux sociaux* screen (`<STUDIO_PUBLIC_URL>/api/studio/social/callback/meta`) and request `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` (and `business_management` for Pages owned through a Business portfolio). Until the app passes App Review, only the app's own admins and testers can connect. Override the requested scopes with `META_SCOPES` and the API version with `META_GRAPH_VERSION`.
2. **TikTok** (developers.tiktok.com): create an app with *Login Kit* and *Content Posting API* (scopes `user.info.basic`, `video.publish`, `video.upload`), add the redirect URI (`…/callback/tiktok`) and verify the URL prefix `<STUDIO_PUBLIC_URL>/api/studio/public/` under *URL properties*: TikTok downloads the media from it. Until TikTok audits the app, direct posts are limited to the *Moi uniquement* visibility; *Envoyer en brouillon* works regardless.
3. Set `STUDIO_PUBLIC_URL` (public https address) and `STUDIO_MEDIA_SECRET`: the networks fetch the media from your server through the signed links described above. Images are re-encoded as JPEG on the fly (`?format=jpeg`) because Instagram and TikTok refuse PNG.
4. Set `SOCIAL_TOKEN_SECRET` (falls back to `AUTH_SECRET`): access and refresh tokens are encrypted with it (AES-256-GCM) before being written next to the workspace, in `social-accounts.json`. Changing the secret makes stored tokens unreadable: reconnect the accounts.

**Scheduling.** In the *Publier* window choose *Programmer* and pick a date and time (your browser's local time; between one minute and one year ahead). Nothing is sent until then: the publication waits as *Programmé* in the history, where it can be cancelled. Two things send it:

- on a **long-running server** (Docker, `npm start`, a VPS) a built-in ticker checks every minute — nothing to configure; set `SOCIAL_SCHEDULER=off` to disable it;
- on **Vercel** or any serverless host there is no resident process, so set `CRON_SECRET` and have a cron call `GET /api/studio/social/run-due` every minute with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header itself; a per-minute schedule needs a plan that allows it). The *Réseaux sociaux* screen warns when scheduled posts have no way to leave.

The same tick also finishes Reels and TikTok uploads still being processed, so a scheduled post completes with nobody looking. The scheduler assumes a single instance: run one server per data directory. If the server was down at the scheduled time, the post goes out as soon as it is back. A scheduled post whose account was disconnected or lost its authorisation is marked *Échec* with the reason rather than silently dropped; it is not retried.

Instagram and TikTok process media on their side, so a publication starts as *Traitement…* and the studio follows it until the post is live (or explains why the network refused it). TikTok sessions are renewed automatically; an account whose authorisation was revoked is flagged *À reconnecter*. Publications are kept in `publications.json` of the workspace.

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

### Publishing from Claude

Four more tools let an agent post what it generates to the accounts connected to a workspace (see *Publishing to social networks*): `list_social_accounts`, `list_generations` (gallery ids), `publish_to_social` and `list_publications`.

- `publish_to_social` takes `accounts` (ids, `instagram`, `instagram:Name` or `@handle`), a `caption`, and exactly one media source: `file` (local path, typically the file `generate_image` just wrote; stdio only), `url` (a link returned by `generate_*` on the hosted endpoint) or `generation` (gallery id). Imported media is added to the workspace gallery. Optional: `scheduledAt` (ISO 8601 with offset), `aspectRatio` (so the Instagram/TikTok format checks apply to imported files), `tiktokMode` (`publish` or `draft`) and `tiktokPrivacy` (default `SELF_ONLY`).
- It posts publicly and cannot be undone from the tool, so its description tells the model to publish only on explicit request and to run it with `dryRun: true` first (reports format and caption problems per account without importing or sending anything).
- Instagram and TikTok finish processing on their side; the result then says *processing* and `list_publications` checks with the platform and reports the final state or link.

Requirements: the MCP server must see the same `STUDIO_DATA_DIR` as the web app (that is where the accounts live), plus `SOCIAL_TOKEN_SECRET`/`AUTH_SECRET` to decrypt the tokens and `STUDIO_PUBLIC_URL`/`STUDIO_MEDIA_SECRET`; the web app must be reachable at that public address because the networks download the media from it. The hosted endpoint on Vercel has an ephemeral filesystem, so use the standalone server (`npm run mcp:http`/Docker) with a volume shared with the web app, or stdio locally.

Security: on the hosted endpoint, anyone holding `MCP_AUTH_TOKEN` can now publish to the connected accounts as well as spend Gateway credits. Keep the token secret and rotate it if it leaks. `url` imports only accept links issued by this studio (files of the standalone server, or Vercel Blob's public domain), never arbitrary addresses.

### Claude Cloud (hosted, Streamable HTTP)

Claude Cloud cannot start a process on your machine, so the studio also exposes the MCP tools over Streamable HTTP. They are the same tools; instead of disk paths, each generation returns download links, and local `outputDir` / reference-image paths are not offered.

There are two ways to host it.

#### On Vercel (same project as the web app)

The Next.js app serves the MCP endpoint at `/api/mcp` (stateless, `maxDuration` 300 s). Generated media is uploaded to the public Vercel Blob store identified by `BLOB_READ_WRITE_TOKEN`; the links carry a random suffix and cannot be guessed. A private store is not supported (Claude could not download its links).

1. In the Vercel project, create a **public** Blob store (Storage → Blob, or `vercel blob create-store <name> --access public -e production`). This sets `BLOB_READ_WRITE_TOKEN` automatically.
2. Add the environment variable `MCP_AUTH_TOKEN` (`openssl rand -hex 32`) and deploy.
3. Register the endpoint:

```bash
claude mcp add --transport http studio https://<your-project>.vercel.app/api/mcp --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

For claude.ai (Settings → Connectors → Add custom connector), which cannot send a custom header, put the token in the URL: `https://<your-project>.vercel.app/api/mcp/<MCP_AUTH_TOKEN>`. Treat that URL as a secret.

The studio library (workspaces and elements) lives on the function's ephemeral disk on Vercel, so `list_workspaces`, `list_elements` and the `elements` argument only see data that exists there. Use the Docker option below if you need a persistent library. Long video generations need a plan that allows 300 s functions.

#### On a Node host with a disk (Docker, Fly, Railway…)

`mcp/http.mjs` is a standalone HTTP server that stores files on disk and serves them at `/files/<random id>/<name>`. Run it locally or on any Node host:

```bash
MCP_AUTH_TOKEN=$(openssl rand -hex 32) MCP_PUBLIC_URL=https://studio-mcp.example.com npm run mcp:http
```

Or build the lightweight image (`Dockerfile.mcp`) and mount a persistent volume on `/data`:

```bash
docker build -f Dockerfile.mcp -t studio-mcp .
docker run -d -p 3333:3333 -v studio-mcp-data:/data \
  -e AI_GATEWAY_API_KEY=... -e MCP_AUTH_TOKEN=... -e MCP_PUBLIC_URL=https://studio-mcp.example.com \
  studio-mcp
```

Put it behind HTTPS (reverse proxy, Fly, Railway, Render…), then register it:

```bash
# Claude Code (bearer header)
claude mcp add --transport http studio https://studio-mcp.example.com/mcp --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

For claude.ai, use `https://studio-mcp.example.com/mcp/<MCP_AUTH_TOKEN>`.

Variables of the standalone server: `MCP_AUTH_TOKEN` (required, 24+ characters), `MCP_PUBLIC_URL` (public base URL used in download links), `MCP_FILES_DIR` (default `./generated-media`), `PORT` (default 3333), plus `AI_GATEWAY_API_KEY`, `MAX_GENERATION_COST_USD` and `STUDIO_DATA_DIR` as above. Anyone holding the token can spend your Gateway credits, so set `MAX_GENERATION_COST_USD`.

## Deployment

Deploy the Next.js application to Vercel, configure the environment variables above, and enable AI Gateway for the linked project. Long video generations use a five-minute function duration and therefore require a compatible Vercel plan and model. Set `STUDIO_PUBLIC_URL` to the deployment address so URL-only video models can fetch reference images and voice tracks.

The studio library (`STUDIO_DATA_DIR`) is written to the local filesystem. On Vercel this storage is ephemeral: use the Docker image or another host with a persistent volume for a durable library, or mount the data directory on shared storage. Private Blob storage and a Postgres database remain the future option for multi-region deployments.

## Migration status

Image, Video, and speech generation use the new Gateway surface. Advanced upstream studios are retained while their MuAPI-specific calls are migrated to the shared job contract. Consult the implementation plan for the ordered milestones.

## License and attribution

MIT licensed. Copyright and attribution from the upstream Open Generative AI project remain in [LICENSE](LICENSE). New fork-specific work is provided under the same license.
