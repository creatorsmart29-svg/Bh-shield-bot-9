# BH SHIELD v1.0.31 Production Audit

## Premium community systems

- Premium systems are isolated in `premium-features.ts` and `schema/premium.ts`; they reuse the existing centralized message, member, reaction, interaction, and maintenance boundaries.
- Auto roles support separate human/bot role lists, welcome roles, delayed joins, temporary roles, role removal configuration, and persisted role cleanup records.
- Reaction-role configuration persists button/emoji mappings, role lists, single-role mode, toggle behavior, and removal behavior. Button panels are published from the setup modal.
- Verification setup persists method configuration, channel, verified role, logs, welcome text, and automatic verification. Enabled button verification publishes a usable verification message.
- Automod checks configured links, invites, caps, emoji spam, blacklist/whitelist words, and applies configured deletion, warning logs, and timeout behavior without interrupting other handlers.
- Starboard uses persisted source/target message records, configured emoji and threshold, bot/NSFW exclusions, live edits, and deletes the starboard copy when the count falls below the threshold.
- Boost handling assigns the configured booster role, sends the configured announcement, and routes logs through the advanced category logger.
- AFK records support server and global scope, mention notifications, and automatic removal on the member's next message.
- Sticky messages are persisted per guild/channel and reposted after the configured message count.
- Backups snapshot roles, channels, and premium settings. Restores require an explicit `confirm` argument and restore settings only; Discord structure changes remain intentionally non-destructive.
- Scheduled tasks and statistic channel updates run through recovered maintenance. Temporary auto roles are removed by the same bounded maintenance path.
- Advanced logging stores category enablement and channel destinations in PostgreSQL and is designed to coexist with existing ticket, moderation, invite, giveaway, transcript, and AI logs.

## Premium setup and compatibility

- `&setup` provides a central premium setup dashboard with Discord selects, buttons, previews, and modal entry points.
- `&autorolesetup`, `&reactionrolesetup`, `&verifysetup`, `&automodsetup`, `&starboardsetup`, and `&boostsetup` open persisted feature panels.
- Existing legacy setup and utility commands remain registered and unchanged for compatibility.
- No runtime DDL was introduced. Development schema synchronization remains `pnpm run db:prepare`; production schema promotion remains owned by the publish/deployment flow.

## Community and engagement expansion

- The expansion is isolated in `engagement-features.ts` and `schema/engagement.ts`; it uses the existing command registry, centralized MessageCreate/InteractionCreate listeners, recovery wrapper, owner logging, and maintenance scheduler.
- XP awards are ignored for bots, commands, and empty content. Chat awards honor per-user cooldowns, daily caps, role bonuses, and active multiplier events.
- Voice XP is accrued by tracked voice sessions and processed through recovered maintenance.
- Rank cards are generated as SVG attachments with avatar, identity, level, XP, progress, rank, server, and configurable visual colors/background.
- Economy transfers use a conditional sender debit so a concurrent request cannot create a negative wallet balance.
- Shop inventory and user inventory use guild/user/item uniqueness constraints and stock-aware buy/sell operations.
- Reputation has one daily giver cooldown and prevents self-reputation.
- Rewards use persisted last-claim timestamps and streak counters.
- Achievements use persisted progress/unlock rows with reward grants.
- Birthday wishes are annual and protected from duplicate sends using `last_wished_year`.
- Suggestions use persisted per-user vote uniqueness, anonymous display mode, and staff decision/comment fields.
- Management changes are recorded in `bh_engagement_audit_logs` with actor, action, target, old value, new value, and timestamp.

## Setup panels and compatibility

- `&welcomesetup`, `&giveawaysetup`, `&pollsetup`, `&announcementsetup`, and `&suggestionsetup` use Discord-native button/modal entry points with preview/cancel behavior.
- Existing legacy setup and utility commands remain registered and unchanged for compatibility.
- The engagement commands are registered during normal server startup, not only in the owner DM route.
- Help Center includes Leveling, Economy, and Community Engagement categories.

## AI platform upgrade

- Existing AI provider investigation found successful OpenAI request initialization and network reachability; the concrete live failure was HTTP 429 `insufficient_quota`.
- Provider error handling now preserves provider name, status, error code, exact sanitized message, response time, and token usage where available.
- Owner DM AI remains permanently enabled for `OWNER_ID` and remains DM-only.
- OpenAI, Gemini, Claude, and Groq are selected by `AI_PROVIDER`; key, model, timeout, history, token, temperature, and endpoint settings come from environment variables.
- All AI requests use a shared bounded queue, rate limit, short-memory cleanup, timeout, and transient retry policy.
- GPT-5/o-series OpenAI requests use the current completion-token parameter shape.

## Per-channel server AI

- Server AI is off by default because no channel row is treated as disabled.
- Administrators with Manage Server or Administrator permission can enable or disable only the current channel with `&ai on|off`.
- `&ai status` reports current-channel state, enabled channels, and configured provider.
- Server AI ignores bots, webhooks, commands, ticket channels, and overlapping requests to prevent loops or duplicate replies.
- AI channel settings are persisted in PostgreSQL with guild/channel uniqueness and created/updated timestamps.
- Server AI errors are isolated, logged, and delivered through the existing owner DM logging queue.

## Database error diagnosis and recovery

- Root cause confirmed: the connected PostgreSQL `bh_guild_settings` table was behind the Drizzle source schema and lacked the newer settings columns selected by the application.
- The SQL generated by Drizzle was valid; the failure was schema drift, not an invalid guild ID, null value, query-builder defect, or connection-string problem.
- Development schema synchronization restored compatibility; the exact full-row `bh_guild_settings` query now succeeds.
- Startup performs read-only verification of all expected tables, columns, indexes, foreign keys, and the guild settings query.
- Runtime schema changes are never attempted automatically. Production changes remain owned by the supported publish/deployment schema flow.
- Transient database errors use bounded retries, health probes, exponential backoff, and duplicate-attempt suppression.
- Schema, query, command, event, and maintenance failures are classified and logged with stack traces, timestamps, recovery actions, results, and guild/user/channel context.
- Failed recovery is sent through the existing Owner DM Logging System while unrelated modules continue operating.

## Community expansion

- Invite tracking uses cached invite deltas and gracefully handles missing Manage Server/invite permissions.
- Invite statistics, member attribution, rejoin state, and departure state are persisted in PostgreSQL.
- Welcome and leave configuration is persisted per guild with preview support and bounded Discord message templates.
- Centralized logs use the configured server log channel and coexist with existing moderation, ticket, review, and transcript destinations.
- Community commands are registered through the runtime registry, so custom prefixes, owner routing, and dynamic Help Center discovery continue to work.

## Owner DM AI and command routing

- Discord `DirectMessages` gateway intent enabled
- Discord DM `Channel` partial enabled
- Owner DM commands are checked before AI fallback
- Default-prefix and permanent No Prefix commands supported in DMs
- Server-only commands return a safe context message in DMs
- Non-owner DM AI access remains denied
- AI recent history is bounded and TTL-cleaned
- AI provider calls are queued, rate limited, retried on transient errors, and timeout-protected

## Secure Owner Help

- Owner category remains present in the Help Center dropdown
- Owner command content is generated from `ownerOnly` registry entries
- Ghost Mode usage is registered as `ghostmode on|off|status`
- Owner metadata includes descriptions, usage, and permissions
- Unauthorized category selection returns only a generic denial embed
- Viewer identity is checked on initial help render and dropdown update

## Universal command routing

- Runtime command registry initialized before Discord message events
- 85 registered built-in commands loaded at startup
- Server default-prefix and custom-prefix parsing use the registry
- Owner permanent No Prefix parsing uses the registry
- Owner DM command parsing uses the registry before AI fallback
- Registered guild-only commands return a safe DM context response
- Registered owner-only commands retain owner authorization checks
- Unknown owner DM messages continue to the existing AI assistant

Audit date: 2026-08-05

## Result

The project is packaged as a complete GitHub/Railway source release. The production runtime uses PostgreSQL with Drizzle ORM, Discord.js 14, Node.js 20+, and pnpm 10. MongoDB was not introduced because the existing ticket data and settings are already stored in PostgreSQL; replacing the database would risk existing server data.

## Repaired

- Required production environment validation for `DATABASE_URL` and `DISCORD_BOT_TOKEN`.
- Explicit PostgreSQL pool error logging.
- Uncaught exception, unhandled rejection, and Node warning logging.
- Graceful SIGTERM/SIGINT shutdown for HTTP and Discord clients.
- Explicit HTTP server bind error handling.
- Initial Discord login retry handling.
- Guarded asynchronous Discord message, edit, delete, interaction, and maintenance handlers.
- Atomic per-panel ticket number reservation.
- Panel/type/guild ownership validation before ticket creation.
- Discord-channel rollback when a ticket database record cannot be saved.
- One-review-per-ticket database protection.
- Safe duplicate-review handling.
- Non-mutating production start command; schema preparation is explicit through `pnpm run db:prepare`.
- Duplicate open-ticket protection per member and ticket type.
- Persistent saved staff replies with ticket-side selection.
- Private AI ticket summaries for authorized staff.
- Configurable staff/customer SLA reminders with audit events.
- Corrected the post-merge database helper to use `pnpm run db:push`.
- Added owner-only DM AI with provider abstraction, bounded memory, rate limiting, retries, and secret redaction.
- Added owner lifecycle status notifications for Discord and process events.
- Added required `OWNER_ID` startup validation and Railway environment documentation.
- Added persistent moderation cases, warning records, moderation configuration, automod, member/channel/voice commands, and temporary-action maintenance.
- Preserved the existing ticket, transcript, review, analytics, owner AI, and status notification systems.
- Acode/Android documentation and Railway deployment instructions.

## Verified

- `pnpm install --frozen-lockfile --offline`
- `pnpm run typecheck`
- `pnpm run build:railway`
- `pnpm run db:prepare`
- Production start with `PORT`, database, Discord token, and AI configuration
- Discord connection verified after the BH SHIELD rebrand.
- HTTP health endpoint `/api/healthz`
- No duplicate review records in the development database
- Git whitespace validation
- Archive completeness and secret-file exclusion
- Saved-reply, duplicate-ticket, AI-summary, and SLA integration checks
- Owner AI provider, authorization, memory, rate-limit, lifecycle, and error-notification checks
- Moderation schema synchronization, typecheck, command routing, permissions, hierarchy, automod, voice intent, and temporary-action checks
- Read-only catalog verification: 17 tables, 224 expected columns, indexes, foreign-key metadata, and the full-row guild settings query
- Live startup verification after recovery integration
- AI provider initialization, adapter selection, exact error handling, queue/retry behavior, channel persistence, and server message routing

## Deployment

1. Extract the complete ZIP.
2. Upload all extracted contents to the root of a new GitHub repository.
3. Connect the repository to Railway.
4. Add `DATABASE_URL`, `DISCORD_BOT_TOKEN`, and `OWNER_ID`; add the shared `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, and tuning variables, plus the provider endpoint variable required by the selected adapter.
5. Railway uses `pnpm run build:railway` and `pnpm start` from `railway.json`.

The application does not run schema mutation during every restart. Run `pnpm run db:prepare` once after provisioning the database or after an intentional schema update, then promote production schema changes through the supported publish flow.