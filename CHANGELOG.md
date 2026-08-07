# Changelog

## 1.0.31 — 2026-08-05

### Premium community systems

- Added a modular premium service and schema using the existing centralized Discord listeners, interaction router, recovery wrapper, owner logging, and maintenance loop.
- Added `&autorolesetup` with human/bot role targeting, multiple roles, join delay, role priority, welcome roles, temporary roles, removal roles, conditions, preview, and enable/disable state.
- Added `&reactionrolesetup` with button role panels, emoji-role mappings, multiple roles, single-role mode, toggling, role removal, previews, and persistent panel state.
- Added `&verifysetup` with configurable verification role/channel, verification button publishing, auto verification, verification logging, and welcome-after-verification responses.
- Added `&automodsetup` configuration for anti-spam, links, invites, mentions, caps, emoji spam, Zalgo, advertisements, blacklist/whitelist words, automatic timeout, warning, and deletion.
- Added `&starboardsetup` with custom channel, threshold, emoji, bot/NSFW exclusions, live updates, and removal when stars fall below the threshold.
- Added `&boostsetup` with booster role assignment, announcements, custom messages, reward configuration, and boost logging.
- Added global/server `&afk` with reasons, mention responses, and automatic removal after speaking.
- Added multiple per-channel sticky messages through `&sticky` and `&unsticky`.
- Added `&embedbuilder` preview flow with title, description, author, footer, color, images, thumbnails, and template-save entry point.
- Added `&backup create|list|load|delete` with roles/channels/settings snapshots and explicit restore confirmation.
- Added `&statssetup`, `&schedule`, and `&logsetup` for server statistic channels, scheduled messages, repeat-ready tasks, and category-based logging.
- Added central `&setup` dashboard for Welcome, Leave, Auto Roles, Tickets, Giveaways, Polls, Announcements, AI, Logging, Automod, Verification, Reaction Roles, Invites, Economy, and Leveling.
- Added persistent premium settings, reaction-role panels, sticky records, backups, scheduled tasks, AFK records, starboard entries, and temporary-role cleanup records with compound indexes.

### Validation and compatibility

- Development schema push applied successfully through `pnpm run db:prepare`; runtime remains read-only for schema changes.
- Existing welcome/leave, invite, tickets, giveaways, polls, announcements, moderation, AI, economy, leveling, custom prefixes, and Owner No Prefix flows remain registered.
- Full workspace typecheck, Railway build, whitespace validation, API health, database verification, and Discord readiness checks pass with 173 commands, 37 tables, 427 columns, and 70 indexes verified.

## 1.0.30 — 2026-08-05

### Community and engagement expansion

- Added a modular, database-backed engagement service without adding duplicate Discord event listeners.
- Added XP from chat with cooldowns, daily limits, role bonuses, configurable multipliers, level calculation, level roles, XP status, server/global leaderboards, and voice XP maintenance.
- Added premium SVG rank cards with avatar, username, level, XP, progress bar, rank, server name, background, color, and accent configuration.
- Added `&rank`, `&leaderboard`, `&level`, `&setlevel`, `&setxp`, `&resetxp`, `&xpmultiplier`, `&xpstatus`, `&rankcard`, and `&levelrole`.
- Added positive reputation with a daily giver cooldown, member inspection, and leaderboard commands.
- Added daily, weekly, and monthly streak rewards with cooldowns and escalating bonuses.
- Added wallet/bank economy commands, conditional payment debits, earning cooldowns, robbery risk, economy balances, and total-earned tracking.
- Added shop item administration, categories, prices, stock, selling, inventory quantities, consumables, collectibles, and equipped state.
- Added achievement definitions, progress records, automatic unlock rewards, and achievement leaderboards.
- Added birthday set/remove/view commands, automated birthday wishes, optional birthday roles, and annual wish suppression.
- Added persisted suggestions with anonymous mode, upvotes, downvotes, and staff accept/reject/consider decisions with comments.
- Added setup entry panels for welcome, giveaway, poll, announcement, and suggestion configuration using buttons, previews, cancel actions, and modals.
- Added engagement audit records with actor, guild, action, target, old value, new value, timestamps, and owner command logging.
- Added ten indexed PostgreSQL engagement tables and integrated them into read-only startup schema verification.

### Compatibility and operations

- Existing invite tracking, legacy welcome/leave commands, giveaways, polls, announcements, moderation, tickets, AI, Owner DM logging, custom prefixes, and permanent Owner No Prefix remain intact.
- Normal server startup now registers community and engagement commands before reporting the command count.
- Full validation passed with 159 registered commands, 28 schema tables, 346 verified columns, 49 indexes, healthy HTTP status, and Discord readiness.

## 1.0.29 — 2026-08-05

### AI platform upgrade

- Diagnosed the existing Owner AI failure as an OpenAI HTTP 429 quota error (`insufficient_quota`), not a network or response-parsing failure.
- Replaced the generic provider error response with the exact sanitized provider message and HTTP status for internal logs and owner notifications.
- Consolidated Owner AI, server AI, ticket AI, and ticket summaries onto one environment-selected provider service.
- Added provider adapters for OpenAI, Google Gemini, Anthropic Claude, and Groq with environment-driven keys, models, endpoints, timeout, history, token, and temperature settings.
- Added modern OpenAI model handling using `max_completion_tokens` and no unsupported temperature parameter for GPT-5/o-series models.
- Added shared request queueing, bounded history, rate limiting, timeout protection, transient retries, response-time logging, and token-usage logging.

### Server AI

- Added `bh_ai_channel_settings` with guild ID, channel ID, enabled state, created timestamp, and updated timestamp.
- Added `&ai on`, `&ai off`, and `&ai status`.
- Server AI is disabled by default per channel and requires Manage Server or Administrator permission to change.
- Enabled channels maintain independent short conversation context; bot messages, webhooks, ticket channels, and command invocations are ignored.
- Server AI failures notify the owner through the existing Owner DM Logging System without interrupting other bot features.

### Compatibility

- Preserved permanent owner DM AI, Owner No Prefix routing, universal DM commands, ticket AI staff suppression, moderation, ticket workflows, Help Center, and centralized logging.

## 1.0.28 — 2026-08-05

### Fixed

- Diagnosed the failing `bh_guild_settings` query as PostgreSQL schema drift: the application schema was newer than the connected database catalog, so Drizzle selected columns that had not been synchronized.
- Verified and synchronized the development schema through the existing Drizzle flow; no query workaround, null fallback, or runtime DDL was introduced.

### Added

- Added read-only startup verification for all Drizzle tables, columns, indexes, foreign keys, and the full-row guild settings query.
- Added centralized recovery handling with error classification, stack traces, timestamps, guild/user/channel context, bounded exponential backoff, database health probes, in-flight deduplication, and duplicate-report suppression.
- Added owner DM notifications for failed recovery and schema drift through the existing logging system.
- Isolated command, Discord event, and scheduled maintenance failures so one rejected operation does not terminate unrelated bot features.

### Safety

- Schema errors are reported as actionable drift and never repaired with automatic startup DDL.
- Database retries are limited to transient connection/transaction failures and stop after a bounded attempt count.

## 1.0.27 — 2026-08-05

### Added

- Added database-backed invite tracking with invite attribution, active invite counts, rejoin/leave tracking, leaderboards, invite lookup, and administrator reset.
- Added configurable welcome and leave systems with channel selection, on/off/preview controls, embeds, images, banners, and member/server variables.
- Added centralized server logging for member joins/leaves, bans, channels, roles, server renames, message edits, and message deletions.
- Added community information, utility, and fun commands for server stats, permissions, calculator, reminders, AFK, 8ball, coinflip, dice rolls, choices, ratings, shipping, and memes.

### Compatibility

- Preserved the existing moderation avatar command and moderation log behavior.
- `&setlog` now configures both the existing moderation log destination and the centralized community log destination.

## 1.0.26 — 2026-08-04

### Added

- Added a secure `👑 Owner` Help Center category.
- Added registry metadata for owner-only command descriptions, usage, aliases, and permissions.
- Added dynamic Owner Help entries for Ghost Mode, No Prefix management, owner DM logging, restart controls, and future `ownerOnly` commands.

### Security

- Owner command metadata is rendered only when the viewer ID matches `OWNER_ID`.
- Unauthorized users receive only a generic Access Denied embed without owner command names, usage, aliases, or internal descriptions.
- Owner Help access is enforced on initial `&help` messages and every dropdown selection update.

## 1.0.25 — 2026-08-04

### Fixed

- Fixed owner DM commands not being received by enabling Discord direct-message events and DM channel partials.
- Ensured registered commands are checked before the owner AI fallback.
- Preserved normal-prefix and permanent owner No Prefix command execution in DMs.

### Improved

- Upgraded the owner AI system prompt for natural greetings, casual conversation, technical assistance, follow-up questions, Markdown, and context-aware answers.
- Added configurable owner AI pending-request limits and provider timeouts.
- Added bounded provider timeout handling with retry support for transient provider failures.
- Kept short-term conversation memory bounded and automatically cleaned by age.
- Documented DM command troubleshooting and all new AI configuration variables.

## 1.0.24 — 2026-08-04

### Added

- Added a centralized runtime command registry with command metadata, aliases, owner-only rules, and guild-context rules.
- Routed server prefix, custom-prefix, owner No Prefix, and owner DM commands through the same registry executor.
- Added a reusable `registerCommand` contract for future command modules and plugins.
- Removed the previous DM-only command recognition dependency on a manually maintained owner command list.
- Added universal execution and failure logging for registry-backed commands.

### Compatibility

- Existing BH SHIELD feature handlers remain in place behind registry adapters.
- Commands marked as server-only receive a safe context response in DMs.
- Existing AI fallback remains active for owner DM messages that do not match a registered command.

## 1.0.23 — 2026-08-04

### Added

- Added owner-only command access in direct messages with both normal-prefix and permanent no-prefix parsing.
- Added clear server-context responses for commands that cannot run from DMs.
- Added a database-backed global No Prefix access list with `&noprefix add`, `remove`, `list`, and `info`.
- Made `OWNER_ID` permanently included in the No Prefix list and protected it from removal or disable actions.
- Added security logging for No Prefix user changes and no-prefix command execution in servers and DMs.

### Security

- Only `OWNER_ID` can execute bot commands in DMs or manage No Prefix access.
- Additional No Prefix users can execute recognized commands in servers but cannot grant access or bypass existing owner-only checks.

## 1.0.22 — 2026-08-04

### Added

- Added a modular utility feature service for announcements, DM announcements, auto replies, giveaways, and interactive polls.
- Added rich announcements with channel targeting, plain text mode, title, description, image, thumbnail, footer, color, timestamp, and optional `@everyone` ping.
- Added rate-limited multi-recipient DM announcements with bot skipping, failure tolerance, and completion summaries.
- Added persistent, case-insensitive exact-match auto replies with add, remove, list, clear, and info commands.
- Added persistent giveaway lifecycle management with entry buttons, role requirements, automatic expiry, winner selection, reroll, pause, resume, delete, and list commands.
- Added interactive polls with up to ten options, live vote counts, anonymous display mode, timed expiry, end, and results commands.
- Added scheduled maintenance for expired giveaways and polls and owner logging for utility actions.

### Preserved

- Existing custom prefixes, Ghost Mode, No Prefix Mode, Help Center, ticket system, moderation, AI, transcripts, reviews, and owner DM logging remain integrated.

## 1.0.21 — 2026-08-04

### Added

- Added owner-only Ghost Mode with `&ghostmode on|off|status`; ordinary owner messages are safely re-sent by the bot with content, mentions, attachments, stickers, and reply references where Discord supports them.
- Added database-backed per-server prefixes with `&setprefix`, `&prefix`, and `&resetprefix`.
- Added owner-only No Prefix Mode with `&noprefix on|off|status`; the owner can use normal commands without the configured prefix.
- Added security-category owner DM logging for Ghost Mode, No Prefix Mode, and prefix changes.

### Safety

- Ghost Mode ignores bot/system messages, non-owner messages, commands, and management text.
- Prefixes reject empty values, whitespace, unsafe mention tokens, backticks, and values longer than five characters.
- Server owners and administrators are required for prefix changes; owner-only modes require `OWNER_ID`.

## 1.0.20 — 2026-08-04

### Changed

- Redesigned `&help` as a premium BH SHIELD Help Center with ordered bot information, credits, live uptime/ping, developer details, and category browsing.
- Added a persistent String Select Menu that updates the existing Help Panel message in place without creating duplicate panels or collectors.
- Added command syntax and short explanations for moderation, tickets, configuration, utility, user, AI, logging, security, fun, and owner categories.
- Split long command lists across multiple Discord embed fields so no category is truncated by Discord field limits.

### Preserved

- The existing `🤖 Invite Bot` link button, URL, `ButtonStyle.Link`, label, and behavior remain unchanged.
- Existing ticket panels, setup selectors, commands, interactions, and other systems remain unchanged.

## 1.0.19 — 2026-08-04

### Added

- Added an owner-only live DM logging system controlled by `&dmlogs on`, `&dmlogs off`, `&dmlogs status`, and `&dmlogs test`.
- Added persistent database-backed logging settings and a bounded retry queue with batching and Discord rate-limit spacing.
- Added separate colored embeds for startup, error, command, moderation, ticket, AI, database, guild, voice, and security events.
- Added command timing/results, ticket lifecycle, transcript, AI, gateway, guild, voice, automod, and process error event coverage.

### Reliability

- Owner DM delivery failures are queued and retried without blocking ticket, moderation, or command execution.
- Logs are restricted to `OWNER_ID`; unauthorized control attempts are recorded as security events when logging is enabled.
- Successful DM sends are not requeued when only the follow-up delivery timestamp persistence fails.

## 1.0.18 — 2026-08-04

### Changed

- Rebranded the active bot, embeds, setup panels, help content, logs, status alerts, ticket transcripts, AI assistant, README, Acode guide, license, and deployment documentation from BH Ticket to BH SHIELD.
- Updated transcript attachment filenames to use the `bh-shield-` prefix.
- Added `BH_SHIELD_AI_MODEL` as the current model configuration variable while retaining a fallback to `BH_TICKET_AI_MODEL` for existing deployments.
- Preserved legacy `bh-ticket` database tables and source module identifiers so existing PostgreSQL data and imports remain compatible.

## 1.0.17 — 2026-08-04

### Added

- Added the requested `&` moderation command suite without removing ticket, AI, transcript, review, analytics, or owner systems.
- Added persistent moderation cases, warning records, case numbers, active status, durations, expiration timestamps, and moderation log delivery.
- Added member moderation commands for bans, unbans, kicks, mutes, timeouts, softbans, temporary bans, temporary mutes, warnings, warning history, and warning clearing.
- Added message/channel commands for purge, clear, slowmode, lock, unlock, lockdown, unlockdown, nuke, and clone.
- Added member, role, nickname, avatar, server, and voice moderation utilities.
- Added automod configuration and enforcement for antispam, antilink, antiinvite, bad words, caps, mention limits, and raid mode.
- Added moderation configuration commands for log channel, moderator role, mute role, and status display.
- Added owner-only process controls and message utilities to the command help panel.

### Improved

- Added the Guild Voice States intent required by voice moderation.
- Added short-lived moderation settings caching to reduce database reads during message monitoring.
- Added persistent maintenance for temporary ban expiration after restarts.

## 1.0.16 — 2026-08-04

### Added

- Added owner-only Discord DM AI with strict `OWNER_ID` and DM-channel authorization.
- Added provider-switchable owner AI service for OpenAI, Gemini, Claude, and Groq-compatible APIs.
- Added bounded owner conversation memory, 30-minute cleanup, per-minute request limits, serialized queueing, retry handling, timeout handling, and friendly failure embeds.
- Added secret-like input redaction before owner AI requests and disabled mentions in AI responses.
- Added owner status embeds for startup, online, restart retry, reconnect, disconnect, resume, shutdown, client/gateway errors, uncaught exceptions, and unhandled promise rejections.
- Added uptime, latency, memory, CPU, guild/user counts, Node.js version, discord.js version, Railway environment, bot version, and sanitized error details to status notifications.

### Security

- Made `OWNER_ID` a required startup configuration.
- Kept the owner AI completely out of server messages, interactions, slash commands, and ticket conversations.
- Never logs provider API keys or other credential values.

## 1.0.15 — 2026-08-04

### Added

- Added duplicate open-ticket protection per member and ticket type.
- Added persistent staff saved replies managed with `&reply add`, `&reply list`, and `&reply delete`.
- Added a Saved reply picker to ticket staff controls.
- Added private AI ticket summaries for authorized staff.
- Added configurable staff and customer SLA reminders.
- Added SLA reminder events to ticket audit logs.
- Added persistent reminder timestamps to prevent repeated notification spam.

### Improved

- Expanded the ticket controls with saved replies and AI summary tools without changing the ticket-only scope.
- Added atomic upsert behavior for saved replies.
- Fixed the post-merge database preparation helper to use the workspace database script.

## 1.0.14 — 2026-08-04

### Fixed

- Added production fail-fast validation for `DATABASE_URL` and `DISCORD_BOT_TOKEN`.
- Added process-level logging for uncaught exceptions, unhandled promise rejections, and Node warnings.
- Added graceful SIGTERM/SIGINT shutdown for the HTTP server and Discord client.
- Added retry handling when the initial Discord login fails temporarily.
- Added guarded asynchronous message, edit, delete, and maintenance handlers to prevent silent failures.
- Made ticket number reservation atomic per panel to prevent duplicate numbers during simultaneous ticket creation.
- Added one-review-per-ticket protection and safe duplicate-review handling.
- Validated panel and ticket-type ownership before creating a ticket.
- Added rollback when a Discord channel is created but its database ticket record cannot be saved.
- Added PostgreSQL pool error logging.
- Removed startup-time database schema mutation from the production start command.
- Added the explicit `pnpm run db:prepare` command for applying the schema before first deployment or after schema changes.

### Preserved

- Kept PostgreSQL/Drizzle as the existing production database architecture. No destructive MongoDB replacement was introduced.
- Preserved the interactive setup wizard, ticket workflows, AI assistant, transcripts, reviews, analytics, logs, and Acode/Railway packaging.

## 1.0.13 — 2026-08-04

### Added

- Added `ACODE.md` with Android/Acode editing guidance.
- Added Termux setup, dependency installation, environment configuration, validation, and local run instructions.
- Documented the distinction between Acode editing, Termux Android execution, and Railway 24/7 hosting.
- Documented the hosted PostgreSQL requirement and safe handling of `.env` credentials on Android.
- Preserved the existing Railway deployment workflow and complete source package structure.

## 1.0.12 — 2026-08-04

### Improved

- Redesigned the `&help` panel as a premium Discord embed with clear Quick Start, Member Tools, Ticket Tools, Administrator Tools, Logging, and feature sections.
- Preserved the existing Invite Bot link button.
- Added the remaining staff ticket utilities to the Help Panel so the command guide is complete.
- Updated the displayed bot version to 1.0.12.

### Preserved

- Existing commands, ticket workflows, interactive setup, permissions, AI, transcripts, reviews, analytics, logs, and customization remain unchanged.

## 1.0.11 — 2026-08-04

### Added

- Added practical Discord utility commands: `&ping`, `&botinfo`, `&serverinfo`, and `&userinfo`.
- Added `&panel list` for administrators to see all panels, publication state, and panel channels.
- Added `&settings view` for a quick server configuration overview.
- Added `&log status` and `&log clear [general|ticket|review|transcript]`.
- Added `&ticket mine` for member ticket history.
- Added administrator ticket tools: `&ticket here`, `&ticket list [status]`, and `&ticket info <ticket-id>`.
- Added database helpers for recent ticket and creator ticket history queries.

### Preserved

- Existing interactive setup, ticket creation, permissions, AI assistant, reviews, transcripts, analytics, logs, and customization remain intact.

## 1.0.10 — 2026-08-04

### Added

- Added the administrator-only `&log` command for assigning a persistent log channel.
- `&log add #channel` sets the general log channel used by ticket and review records when specialized channels are not configured.
- `&log add general #channel`, `&log add ticket #channel`, `&log add review #channel`, and `&log add transcript #channel` are supported for explicit destinations.
- The command validates that the selected channel is a usable text or announcement channel before saving it.

### Preserved

- Existing ticket, review, transcript, AI, panel, and log behavior remains unchanged.

## 1.0.9 — 2026-08-04

### Added

- Added the administrator-only `&reviews` command.
- The command creates a persistent, paginated Review Records panel in the current channel.
- Review records show the reviewer, staff member, ticket number, staff behavior rating, response speed rating, overall experience rating, feedback/reason, and submission time.
- Added Previous, Next, and Refresh controls for the records panel.
- Every submitted review is automatically posted as a detailed embed to the configured Review Log channel, with the general log or Ticket Log channel as fallback.

### Preserved

- Existing ticket close, in-ticket review, transcript DM, ticket-log, AI, panel, and permission behavior remains unchanged.

## 1.0.8 — 2026-08-04

### Changed

- Transcripts are now sent privately to the ticket creator's DM.
- The selected Ticket Log channel receives the complete close summary and review details; transcript files are not posted in server channels.
- Closing a ticket now posts the review panel inside the ticket channel.
- The ticket remains in review-pending state until the creator submits the review, then the transcript is delivered, the ticket is logged, and the channel is deleted.
- Claim updates now preserve the priority control and refresh the published dropdown panel after ticket creation.
- Ticket creation validates the selected panel/type category before creating the channel, ensuring tickets appear under a real Discord category.

### Fixed

- Prevented messages from reopening tickets that are waiting for their review.
- Prevented duplicate or stale close finalization by requiring the ticket to be in the closing state.

## 1.0.7 — 2026-08-04

### Added

- Added a bot-mention invite panel for messages such as `@BH SHIELD invite`, regardless of the word's capitalization.
- The panel includes the requested premium embed, timestamp, footer, and Discord link button.

### Preserved

- Bot-authored messages are ignored.
- Mentions without the word `invite` do not respond.
- Existing prefix commands, ticket handling, Help Panel behavior, and the single message listener remain unchanged.

## 1.0.6 — 2026-08-04

### Added

- Added a `🤖 Invite Bot` Discord link button to the existing `&help` panel.
- The button opens the official BH SHIELD OAuth2 invite URL and is visible to every user who can access the Help Panel.

### Preserved

- Existing Help Panel text and all ticket commands, panels, dropdowns, embeds, and controls remain unchanged.

## 1.0.5 — 2026-08-04

### Changed

- Guild owners and members with Discord Administrator permission can open unlimited tickets.
- Owners and administrators bypass the simultaneous open-ticket limit, hourly/daily creation quota, and ticket creation cooldown.
- Blacklist rules remain enforced independently as a security control.

## 1.0.4 — 2026-08-04

### Added

- Added a separate per-member ticket creation quota, independent of simultaneous open tickets.
- Default quota is 3 tickets per day.
- Administrators can change the quota count and choose an hourly or daily window from the interactive Ticket limits section.
- Members receive a Discord relative reset time when their quota is reached.

### Preserved

- The maximum simultaneous open-ticket limit remains independent.
- Existing cooldown, blacklist, whitelist, panel, ticket type, review, transcript, and AI behavior remain unchanged.

## 1.0.3 — 2026-08-04

### Fixed

- Repaired live review configuration and enabled the configured review channel.
- Enabled HTML/PDF transcripts and configured the existing review channel as the transcript destination when no dedicated transcript channel exists.
- Fixed AI conversation records so the internal control flag is not written as an invalid database column.
- Replaced silent transcript, review, and AI failures with operational logs.
- Added a compatible default AI model and corrected the OpenAI completion token option.
- Prevented AI messages from changing staff response timing or causing unnecessary AI activity resets.
- Added clear handling for duplicate panel names during setup.

## 1.0.2 — 2026-08-04

### Changed

- Review panels are no longer posted inside ticket channels.
- Review panels are sent only to the configured review channel.
- HTML and PDF transcripts are sent only to the configured transcript channel.
- Removed all review and transcript DM delivery behavior.
- Review messages no longer include transcript attachments.

## 1.0.1 — 2026-08-04

### Fixed

- Review panels are now posted directly inside the closed ticket channel.
- Removed the review DM fallback so ticket creators can submit feedback without leaving Discord.
- Added a clearer review embed explaining how to rate the support experience.
- Preserved the existing review button, modal, database storage, transcript delivery, and five-second ticket deletion flow.

## 1.0.0 — 2026-08-04

### Added

- Premium Discord-native panel setup wizard started with `&panel create`.
- Persistent setup drafts with interactive buttons, dropdowns, and modals.
- Configurable panel appearance, images, categories, support roles, permissions, ticket types, questions, AI, transcripts, reviews, logs, limits, previews, and publishing.
- Railway deployment configuration with build command, production start command, health check, and restart policy.
- Complete Railway deployment documentation and environment variable template.

### Improved

- Root project now exposes a production-ready `pnpm start` command.
- Production startup synchronizes the Drizzle database schema before starting the bot.
- Discord gateway connection, reconnection, shard errors, and client errors are logged for operational visibility.
- Workspace and API package versions are aligned to the first stable release.

### Compatibility

- Node.js 20 or newer.
- pnpm 10.26.1 or newer in the pnpm 10 series.
- Railway Nixpacks deployment with a Railway PostgreSQL database.