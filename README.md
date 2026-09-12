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

## Deployment

Deploy the Next.js application to Vercel, configure the environment variables above, and enable AI Gateway for the linked project. Long video generations use a five-minute function duration and therefore require a compatible Vercel plan and model.

Creative-library references are currently stored in IndexedDB on the device that created them, with automatic resizing to keep generation requests compact. Private Blob storage and a Marketplace Postgres database remain the future option for cross-device synchronization, persistent media history, and job orchestration. Until those are connected, Gateway-native outputs are returned directly to the authenticated browser and are not persisted by the new layer.

## Migration status

Image, Video, and speech generation use the new Gateway surface. Advanced upstream studios are retained while their MuAPI-specific calls are migrated to the shared job contract. Consult the implementation plan for the ordered milestones.

## License and attribution

MIT licensed. Copyright and attribution from the upstream Open Generative AI project remain in [LICENSE](LICENSE). New fork-specific work is provided under the same license.
