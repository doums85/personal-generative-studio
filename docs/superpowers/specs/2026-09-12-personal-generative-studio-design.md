# Personal Generative Studio — Design Specification

## Purpose

Build a private, single-user creative AI suite inspired by the functional breadth of Higgsfield AI. The application will fork the MIT-licensed Open Generative AI project, preserve useful studios and workflows, and replace its MuAPI dependency with an internal generation layer centered on Vercel AI Gateway.

The product is for personal use. It will not include subscriptions, customer billing, public registration, teams, or a credit marketplace. The owner pays model providers through their own Vercel AI Gateway account.

The product will be original in name, branding, and interface. It will reproduce useful workflows, not Higgsfield's proprietary code, models, assets, or visual identity.

## Success Criteria

1. Only the configured Google account can access the application or its generated assets.
2. The owner can generate and manage images, videos, audio, music, speech, and multi-step creative projects from one web application.
3. Vercel AI Gateway is the default route for every supported modality.
4. Model availability and pricing are discovered dynamically rather than maintained as a permanently hard-coded catalog.
5. Every generation shows an estimated cost before submission and records the actual cost when available.
6. Configurable per-job and daily spending limits prevent accidental overspending.
7. Long-running generations survive navigation and can be resumed, inspected, retried, or cancelled when the provider supports cancellation.
8. Provider credentials never reach browser code, logs, or generated asset URLs.

## Scope

### Foundation

- Next.js web application deployable on Vercel.
- Google authentication with an exact email allowlist.
- Private project library, generation history, favorites, search, and downloads.
- Personal settings for preferred models, quality mode, cost limits, and storage retention.
- Responsive desktop-first interface with usable mobile views.

### Image Studio

- Text-to-image and image-to-image generation.
- Multiple reference images where supported.
- Inpainting, object removal, background removal or replacement, outpainting, upscaling, and enhancement.
- Reusable style references and character identity profiles.
- Side-by-side comparison and variant generation.

### Video Studio

- Text-to-video, image-to-video, and video-to-video.
- First-frame and last-frame control where supported.
- Reference video, motion guidance, extension, aspect ratio, duration, resolution, and native audio controls where supported.
- Side-by-side variants and frame extraction.

### Cinema Studio

- Shot-based projects with scene, subject, lighting, mood, lens, focal length, aperture, camera angle, and aspect-ratio controls.
- A composable camera-motion vocabulary that translates user choices into provider-specific parameters or prompt instructions.
- Continuity references across shots.

### Audio Studio

- Text-to-music and text-to-sound-effects.
- Text-to-speech, voice selection, transcription, and translation/dubbing.
- Audio upload, trimming, preview, and reuse across projects.
- Source separation and enhancement only when supported by an available model.

### Lip-sync and Avatars

- Image-and-audio to talking video.
- Video-and-audio lip synchronization.
- Generated speech or uploaded audio as input.
- Reusable character profiles and reference sets.

### Storyboard and Creative Assistant

- Convert an idea or script into scenes and shots.
- Generate structured prompts, reference frames, and draft outputs.
- Let the owner approve or edit every paid generation before submission.
- Preserve characters, styles, locations, and camera intent across a project.

### Marketing Studio

- Product-image workflows and short promotional videos.
- Social-media aspect ratios and reusable creative templates.
- Multiple creative variations from one approved brief.

### Canvas and Workflows

- Visual assembly of assets and generation steps.
- Reusable typed workflow nodes for text, image, video, and audio operations.
- Explicit inputs and outputs for each node, with per-node cost estimates.
- Manual execution initially; automated multi-step execution follows after core studios are stable.

## Out of Scope

- Public registration or anonymous access.
- Customer subscriptions, payments, invoices, credit packs, referrals, or plan management.
- Team workspaces and collaboration permissions.
- Training proprietary foundation models.
- Copying Higgsfield trademarks, proprietary models, marketing assets, or pixel-identical UI.
- Promising that every named third-party model will remain available indefinitely.

## Architecture

### Application Shell

The application will use the forked Open Generative AI codebase as an acceleration layer. Existing components will be retained only when they fit the target architecture and quality bar. MuAPI-specific browser calls, key storage, model schemas, and billing concepts will be removed or isolated behind adapters.

The web application is the primary product. Electron and local-inference support may remain buildable if they do not obstruct the web architecture, but they are not required for the first production release.

### Authentication and Authorization

Auth.js will handle Google OAuth. A server-only `ALLOWED_EMAILS` configuration will contain the owner's allowed address. Authentication callbacks will reject every other account.

Authorization will be enforced in three places:

1. middleware protects application routes;
2. server actions and API routes independently verify the session and allowlist;
3. asset access uses short-lived signed URLs after an authorization check.

Public sign-up screens and user discovery do not exist.

### Generation Engine

All studios call a shared generation engine through a modality-neutral job contract. A job records:

- project and owner;
- modality and operation;
- normalized input assets and prompt;
- requested capability constraints;
- selected routing mode and model;
- cost estimate and spending-policy decision;
- provider request identifier and status;
- output assets, usage, and actual cost;
- timestamps, retry ancestry, and error classification.

Provider adapters translate this contract into model-specific requests and normalize responses. Vercel AI Gateway is the primary adapter. Direct-provider adapters are added only when a required capability is unavailable through Gateway and the owner explicitly configures that provider.

### Dynamic Model Catalog

The catalog periodically reads the AI Gateway model endpoint and stores a short-lived normalized cache. Models are classified by modality and declared capabilities. A small reviewed override file supplies missing metadata such as supported aspect ratios, reference limits, or operation-specific controls.

The interface never assumes a model exists because it existed during development. Disabled or removed models disappear gracefully while historical jobs retain their original model identifier.

### Routing Modes

- **Manual:** use the exact model selected by the owner.
- **Economy:** choose the least expensive compatible model above a configurable minimum quality tier.
- **Balanced:** optimize a weighted score of price, reliability, latency, and quality.
- **Maximum quality:** prefer the highest-quality compatible model within the per-job spending limit.

Routing is deterministic for the same catalog snapshot and policy settings. The selection and its rationale are shown before submission.

Automatic fallback is permitted only before a provider accepts a billable job or when the provider proves the failed attempt was not billed. Ambiguous failures require owner confirmation before another paid attempt.

### Job Execution

The browser creates a job through an authenticated server endpoint. The server validates inputs, resolves assets, calculates the estimate, applies spending policy, selects a model, and submits the request.

Short operations may complete in the request lifecycle. Long image, video, music, and workflow operations use asynchronous jobs. Provider webhooks are preferred; bounded polling is used when webhooks are unavailable. Job status is persisted so navigation and browser restarts do not lose work.

### Data and Storage

- Postgres stores users, projects, jobs, model snapshots, routing decisions, settings, workflows, and asset metadata.
- Vercel Blob stores private uploaded and generated media.
- Assets use opaque identifiers, validated MIME types, size limits, and short-lived signed access.
- Temporary provider files and failed uploads are cleaned by a scheduled retention job.
- Deleting a project uses a recoverable soft-delete period before permanent asset removal.

The database layer will be isolated behind a repository interface so a different Postgres host can be used without changing studio code.

## Security and Privacy

- Gateway and provider credentials are server-only environment variables.
- Uploaded content is validated by type and size; filenames never determine storage paths.
- State-changing routes use authenticated sessions and origin/CSRF protections appropriate to the framework.
- Security headers and restrictive content policies are enabled.
- Logs contain job identifiers and sanitized operational metadata, not prompts, access tokens, or signed asset URLs by default.
- The owner can request deletion of source and output assets from the library.
- Provider data-retention capabilities are displayed when available but are not misrepresented as guarantees.

## Cost Controls

Before submission, the engine calculates the best estimate possible from current model pricing and requested duration, resolution, quantity, or token limits. The interface shows that estimate and labels uncertain estimates.

Configurable protections include:

- maximum estimated cost per job;
- warning threshold per job;
- daily soft warning and hard stop;
- maximum parallel jobs;
- explicit confirmation for unusually expensive operations;
- project and studio cost summaries.

The application also tags Gateway requests by studio, environment, and project for independent verification in Vercel's observability tools.

## Error Handling

Errors are normalized into validation, authorization, spending-policy, rate-limit, provider-rejection, provider-outage, timeout, ambiguous-billing, storage, and internal categories.

The interface gives the owner an actionable message without leaking provider secrets. Retry is offered only when safe. Rate limits display the retry time. Partial workflow results remain available. Webhook processing is idempotent, and duplicate provider events cannot create duplicate assets or charges in local accounting.

## User Experience

The interface will be inspired by professional creative workspaces without copying Higgsfield's visual identity. It will use an original name and design system.

The main layout contains a studio switcher, project context, central creation canvas, contextual controls, generation queue, and asset library. Advanced controls stay collapsed until their selected model supports them. Every paid action displays the selected model and estimated cost immediately before submission.

## Delivery Phases

### Phase 1 — Private Core

- Fork and baseline the source project.
- Remove public/commercial and MuAPI-specific assumptions.
- Add Google allowlist authentication.
- Add database, private object storage, settings, dynamic model catalog, job schema, cost policy, and Gateway adapter.
- Deliver the library plus functional Image, Video, and Audio studios.

### Phase 2 — Creative Continuity

- Add character/style profiles, reference management, lip-sync, dubbing, Cinema Studio, and Storyboard.

### Phase 3 — Production Workflows

- Add Marketing Studio, reusable templates, Canvas, and manually executed workflow graphs.

### Phase 4 — Orchestration and Optimization

- Add assisted multi-step execution, provider-aware optimization, richer comparisons, local-inference adapters, and automated retention controls.

Each phase must produce a deployable application and preserve compatibility with stored projects from earlier phases.

## Testing and Verification

- Unit tests cover model normalization, capability matching, routing scores, cost estimates, spending limits, error classification, and idempotency.
- Integration tests cover authentication rejection, protected APIs, job creation, provider adapter contracts, webhook verification, storage authorization, and database transitions.
- Browser tests cover login, one successful generation per modality, failed generation recovery, library access, cost warnings, and logout protection.
- Adapter contract fixtures allow tests without making paid provider calls.
- A small opt-in live smoke suite verifies configured Gateway models with strict spending caps.
- Production readiness requires type checking, linting, automated tests, a successful build, and manual verification on a Vercel preview deployment.

## Migration Strategy

The source repository will be imported with its license and attribution intact. The first implementation pass will inventory studios, shared components, API calls, browser storage, and MuAPI coupling. Changes will be incremental: introduce the new contracts, route one studio through them, then migrate remaining studios. Old direct calls are removed only after equivalent paths are verified.

No existing secret or generated build artifact from the upstream repository will be copied into the new project history.

## Implementation Constraints

- Model identifiers and pricing must be discovered from current provider metadata; implementation must not rely on remembered model lists.
- Every provider-specific capability is optional at the shared-contract level.
- Studio components must not import provider SDKs directly.
- A failed or unavailable optional studio must not prevent the rest of the application from loading.
- The initial implementation favors a deep, reliable personal tool over public SaaS abstractions.

## Approved Addendum — Creative Foundations Library

The personal studio includes a dedicated library for reusable creative foundations. An element has a stable name, a type (character, place, object, product, or visual style), a continuity description, and an optional visual reference. The owner can import a reference image or generate one through AI Gateway.

The first implementation stores these private elements in IndexedDB on the current device, avoiding a paid database dependency and allowing larger references than browser key-value storage. References are resized before storage and may be selected in Image Studio or Video Studio. Selected descriptions are appended to the generation instructions; compatible Gateway models also receive the reference images directly. Up to three references are sent per generation to stay within practical request-size limits.

The old Explore Apps entry and view are removed. Requests to its former route open the Creative Library instead.

Model selectors display live Gateway pricing with explicit units. Flat image prices are shown per image, video duration prices per second, speech prices per million characters, and token-based image pricing per million input/output tokens. Missing provider metadata is labeled as unavailable rather than guessed.
