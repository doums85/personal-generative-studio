# Personal Generative Studio — Implementation Plan

## Objective

Deliver the first deployable foundation of the approved personal generative-media suite by forking Open Generative AI, preserving license attribution, introducing a provider-neutral generation core, and routing supported models through Vercel AI Gateway.

## Milestone 1 — Baseline and Inventory

1. Clone the upstream repository with full Git history into `outputs/personal-generative-studio`.
2. Preserve the upstream remote and add the approved design and implementation documents.
3. Verify the unmodified install, tests, type checks, and production build.
4. Inventory studios, API routes, MuAPI calls, browser key storage, model metadata, persistence, Electron-only modules, and commercial UI.
5. Record baseline failures separately from regressions introduced by the fork.

## Milestone 2 — Private Application Shell

1. Add Auth.js with Google OAuth.
2. Enforce a server-only exact-email allowlist.
3. Protect pages, APIs, server actions, and media access independently.
4. Remove public registration, commercial billing, white-label promotion, and browser-stored provider secrets.
5. Add a minimal authenticated settings page and environment template.
6. Test allowed login, rejected login, unauthenticated APIs, and logout.

## Milestone 3 — Data, Assets, and Jobs

1. Define focused domain contracts for projects, assets, generation jobs, model capabilities, estimates, routing decisions, and errors.
2. Add Postgres persistence behind repository interfaces.
3. Add private Vercel Blob storage behind an asset-store interface.
4. Implement signed asset access, validated uploads, soft deletion, and cleanup metadata.
5. Implement idempotent job state transitions and normalized error categories.
6. Test domain rules without paid external calls.

## Milestone 4 — AI Gateway Core

1. Add the current Vercel AI SDK and Gateway integration according to live documentation.
2. Discover text, image, video, and audio-capable models dynamically.
3. Normalize provider metadata and supplement only missing capability details with reviewed overrides.
4. Implement Manual, Economy, Balanced, and Maximum Quality routing policies.
5. Implement cost estimation, job and daily spending policies, Gateway tags, and safe fallback rules.
6. Add adapter contract fixtures and an opt-in capped live smoke test.

## Milestone 5 — First Usable Studios

1. Migrate Image Studio to the shared generation engine.
2. Migrate Video Studio, including asynchronous polling or webhook completion.
3. Migrate Audio Studio for music, sound, speech, and transcription capabilities exposed by the live catalog.
4. Add the shared queue, progress, history, retry, comparison, and download experience.
5. Hide unsupported controls per selected model rather than failing after submission.

## Milestone 6 — Production Verification

1. Run formatting, linting, type checking, unit, integration, and browser tests.
2. Run a production build and inspect bundled client code for secrets.
3. Verify a Vercel preview deployment with strict test budgets.
4. Document setup for Google OAuth, AI Gateway, Postgres, Blob, and spending controls.
5. Tag the first private-core release.

## Follow-on Milestones

- Character and style continuity, lip-sync, dubbing, Cinema Studio, and Storyboard.
- Marketing Studio, reusable templates, Canvas, and manual workflow graphs.
- Assisted multi-step orchestration, local inference, and deeper routing optimization.

## Working Rules

- Migrate one vertical studio flow end to end before broad mechanical rewrites.
- Add or update tests before changing behavior where a stable seam exists.
- Never make a paid model call in the default automated test suite.
- Never expose provider credentials or private Blob URLs to unauthenticated clients.
- Preserve upstream attribution and keep the upstream remote available for future merges.
- Keep unrelated upstream behavior unchanged until its migration milestone.

