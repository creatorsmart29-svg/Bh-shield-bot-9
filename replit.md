# BH SHIELD

BH SHIELD is a premium Discord-native support and community management bot configured entirely with interactive Discord components.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` or `npm run dev --workspace=@workspace/api-server` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` or `npm run build` — typecheck + build the deployable API/bot artifact
- `pnpm run build:railway` — validate and build the deployable API/bot artifact
- `pnpm start` or `npm start` — start the production bot service without mutating the database
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `OWNER_ID`
- Optional env: `OPENAI_API_KEY`, `BH_SHIELD_AI_MODEL`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `LOG_LEVEL`

## Stack

- pnpm workspaces, Node.js 20+, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Discord: discord.js 14
- AI: OpenAI-compatible Support Assistant
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/lib/discord-bot.ts` — Discord commands, interactive setup wizard, ticket interactions, AI, reviews, and lifecycle handling
- `artifacts/api-server/src/lib/bh-ticket.ts` — database-backed ticket, panel, draft, transcript, analytics, review, archive, and search services
- `lib/db/src/schema/bh-ticket.ts` — source-of-truth PostgreSQL schema
- `railway.json` — Railway build, start, health check, and restart policy
- `README.md` — deployment and operator documentation
- `CHANGELOG.md` and `VERSION` — release metadata

## Architecture decisions

- Configuration is Discord-native: `&panel create` opens the setup wizard; administrators do not need a chain of setup commands.
- Setup drafts persist in PostgreSQL and are publish-gated so unfinished configuration never becomes visible to end users.
- Railway deploys only the API/bot artifact; the mockup sandbox remains a design-time workspace package.
- Schema preparation is explicit through `pnpm run db:prepare`; the production start command does not mutate the database.
- Discord.js manages gateway reconnection while the bot logs disconnect, reconnect, shard error, and resume events.

## Product

BH SHIELD provides configurable ticket panels, ticket types and modal questions, staff permissions, AI assistance, transcripts, reviews, analytics, logs, tags, notes, search, archives, and restoration alongside its moderation and utility systems.

## User preferences

- Every stable BH SHIELD release must include a complete source ZIP suitable for GitHub and Railway.
- Each release ZIP must include all source/configuration files, README deployment instructions, environment template, version, and changelog.
- Before delivery, validate dependencies, TypeScript, builds, database synchronization, production startup, health, runtime logs, and existing ticket features.
- New features must preserve existing functionality and automatically reconnect after temporary Discord network issues.

## Gotchas

- Railway supplies `PORT`; local production runs need `PORT` and `DATABASE_URL` exported in the shell.
- The mockup sandbox Vite build requires `PORT` and `BASE_PATH`; Railway intentionally skips that design-only package.
- Heaven Cloud/Pterodactyl must use `corepack enable && pnpm install --frozen-lockfile`, `pnpm run build`, and `pnpm start`; the production entrypoint is `artifacts/api-server/dist/index.mjs`.
- Keep real environment values out of source control; use `.env.example` only as a safe template.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `README.md` for Railway deployment and release instructions
