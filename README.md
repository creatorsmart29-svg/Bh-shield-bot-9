# BH SHIELD

BH SHIELD is a database-driven Discord support and community management bot. It is managed directly inside Discord with the `&` prefix, interactive embeds, buttons, dropdowns, and modals. Ticket workflows, moderation, automod, utilities, owner controls, and AI support are kept in separate systems.

## Stable release

**Version:** 1.0.31

The complete release history is in [CHANGELOG.md](./CHANGELOG.md).

## Features

- Discord-native interactive setup launched with `&panel create`
- Persistent panel drafts that can be resumed after a restart
- Unlimited panels and ticket types
- Button or dropdown ticket creation
- Custom panel embeds, colors, author, footer, timestamp, thumbnail, banner, and welcome message
- Per-panel categories, support roles, manager roles, manager users, naming formats, and numbering
- Ticket types with their own categories, welcome messages, support roles, naming formats, and questions
- Modal questions for short text, long text, number, email, and URL values
- Claim, add user, remove user, rename, close, and optional priority controls
- Maximum open-ticket limits, cooldowns, blacklist, whitelist, and empty-ticket auto-archive
- Per-member ticket creation quotas, configurable as 3 tickets per hour or per day
- Unlimited ticket creation for guild owners and Discord administrators
- Help Panel Invite Bot link button
- Bot mention invite panel for `@BH SHIELD invite`
- Private member transcript delivery with ticket-log close summaries
- In-ticket review-before-delete workflow
- Administrator review records panel with pagination via `&reviews`
- Automatic detailed review embeds in the configured Review Log channel
- Administrator log-channel command via `&log add #channel`
- Common utility commands: ping, bot info, server info, and user info
- Moderation cases with persistent warning history and moderation log embeds
- Ban, unban, kick, mute, timeout, softban, temporary ban, and temporary mute commands
- Purge, slowmode, lock, lockdown, nuke, clone, nickname, role, and voice moderation tools
- Persistent moderator role, mute role, and moderation log configuration
- Automod filters for spam, links, invites, bad words, caps, mention limits, and raid mode
- Message utilities for `&say`, `&embed`, `&announce`, and `&poll`
- Owner-only `&reload`, `&restart`, `&shutdown`, `&eval`, and `&sync` controls
- Panel, settings, log status, and ticket history inspection commands
- Premium grouped Help Center embed with Invite Bot link
- Acode-friendly Android editing guide with Termux run instructions
- Complete production audit report in [AUDIT-REPORT.md](./AUDIT-REPORT.md)
- Reliable category placement and dropdown panel refresh
- Permanent owner-only DM AI plus configurable OpenAI, Gemini, Claude, and Groq provider adapters
- Per-channel server AI, disabled by default and controlled with `&ai on|off|status`
- AI conversation awareness that stops AI replies when staff respond
- HTML and PDF transcript generation with ticket history, embeds, images, attachments, edits, and deletions
- Post-close review panel, review records, and staff leaderboard
- Ticket analytics, staff performance, logs, tags, notes, search, history, archives, and restoration
- Saved staff replies with a ticket dropdown picker
- Private AI conversation summaries for authorized staff
- Duplicate open-ticket protection per member and ticket type
- Configurable staff and customer SLA reminders
- Owner-only DM AI assistant with provider switching, bounded memory, rate limits, retries, and secret redaction
- Owner DM status notifications for startup, gateway, process, and error lifecycle events
- Optional owner-only live DM logging with queued category embeds controlled by `&dmlogs on|off|status|test`
- Premium interactive Help Center with live bot information, credits, command categories, explanations, and the existing Invite Bot link button
- Owner Ghost Mode, owner-only No Prefix Mode, and database-backed custom per-server prefixes
- Utility expansion with announcements, rate-limited DM announcements, auto replies, giveaways, and interactive polls
- Owner DM command access with permanent owner No Prefix and owner-managed global No Prefix users
- Runtime command registry routing for normal prefixes, custom prefixes, owner No Prefix, and owner DMs
- Invite tracking with per-server statistics, leaderboards, invite attribution, leave tracking, and reset controls
- Configurable welcome and leave embeds with channel routing and `{user}`, `{mention}`, `{server}`, `{memberCount}`, and `{username}` variables
- Centralized server logs for members, bans, channels, roles, messages, and server updates through `&setlog`
- Community utility, information, and fun commands including member counts, permissions, calculator, reminders, AFK, 8ball, coinflip, roll, choose, ship, rate, and meme
- Community engagement expansion with XP leveling, voice XP, cooldowns, daily limits, role bonuses, multiplier events, level roles, server/global leaderboards, and SVG rank cards
- Persistent reputation, daily/weekly/monthly reward streaks, wallet/bank economy, anti-negative-balance transfers, work/beg/crime/rob cooldowns, shop stock, inventory, consumables, collectibles, and equipment
- Achievement progress and unlock rewards, birthday records with automated wishes and birthday roles, and database-backed suggestions with upvote/downvote tracking and staff decisions
- Premium setup entry panels for welcome, giveaway, poll, announcement, and suggestions configuration using buttons, previews, cancel actions, and modals
- Engagement audit logs recording actor, guild, action, target, old value, and new value; cached guild settings and indexed guild/user queries for Railway-friendly operation
- Premium Auto Role setup with human/bot roles, multiple roles, delays, welcome roles, temporary roles, removal roles, conditions, previews, priorities, and enable/disable controls
- Premium Reaction Roles with button panels, emoji mappings, role toggles, single-role mode, removal behavior, previews, and persistent configuration
- Button verification setup with verified roles, verification channel, welcome-after-verification message, verification logging, and automatic verification option
- Premium automod setup with anti-spam, link/invite, mention, caps, emoji, Zalgo, advertisement, bad-word/whitelist, auto-timeout, auto-warn, and auto-delete controls
- Starboard setup with channel, minimum stars, bot/NSFW exclusions, custom emoji, live updates, and threshold removal
- Boost setup with booster roles, announcements, custom messages, rewards configuration, and boost logs
- Global/server AFK with reasons, mention notifications, and automatic removal when members speak
- Multiple per-channel sticky messages with automatic reposting and `&sticky` / `&unsticky`
- Interactive embed builder preview with title, description, author, footer, color, image, thumbnail, and reusable-template entry point
- Database-backed server backups with roles/channels/settings snapshots, lists/deletion, explicit restore confirmation, and audit logging
- Scheduled messages with one-time or repeat-ready task records, server statistics channels, and configurable advanced log categories
- Central `&setup` dashboard for premium feature access, with buttons, selects, previews, modals, and PostgreSQL-backed configuration
- Read-only startup database schema verification for tables, columns, indexes, and foreign keys
- Bounded database recovery with transient-error retries, health probes, exponential backoff, duplicate suppression, and owner notifications
- Isolated command, event, and maintenance failures so unrelated bot features continue running
- Railway health check and automatic restart configuration

## Premium commands

`&autorolesetup`, `&reactionrolesetup`, `&verifysetup`, `&automodsetup`, `&starboardsetup`, `&boostsetup`, `&setup`, `&afk [global] [reason]`, `&afk remove`, `&sticky <message>`, `&unsticky`, `&embedbuilder`, `&backup create|list|load <id> confirm|delete <id>`, `&statssetup`, `&logsetup`, and `&schedule <10m|2h|1d> <message>`.

Premium setup configuration is stored in the dedicated `bh_premium_*` PostgreSQL tables and uses the existing centralized command, interaction, recovery, logging, and maintenance paths. Existing legacy welcome, invite, ticket, giveaway, poll, announcement, moderation, AI, economy, and leveling commands remain available.

## Community engagement commands

The v1.0.31 engagement and premium layers are registered through the same command registry as existing BH SHIELD commands, so custom prefixes, permanent Owner No Prefix, owner DM routing, Help Center discovery, and centralized error isolation remain active.

### Leveling and reputation

`&rank`, `&leaderboard [global]`, `&level`, `&setlevel`, `&setxp`, `&resetxp`, `&xpmultiplier`, `&xpstatus`, `&levelrole`, `&rankcard`, `&rep`, `&reputation`, and `&repleaderboard`.

Chat XP respects a per-user cooldown and daily cap. Voice XP is awarded by the maintenance loop. XP can include role bonuses and time-limited multipliers. Rank cards include avatar, username, level, XP, progress, rank, server name, and configurable colors/background.

### Rewards and economy

`&daily`, `&weekly`, `&monthly`, `&balance`, `&pay`, `&deposit`, `&withdraw`, `&work`, `&beg`, `&crime`, `&rob`, `&shop`, `&buy`, `&sell`, `&additem`, `&removeitem`, `&edititem`, `&inventory`, `&use`, `&equip`, and `&unequip`.

Wallet and bank balances are stored per guild/member. Transfers require a conditional wallet update, preventing negative sender balances when concurrent commands race.

### Achievements, birthdays, and suggestions

`&achievements`, `&achievement`, `&achievementleaderboard`, `&birthday set|remove`, `&birthday`, `&suggest`, `&suggestion accept|reject|consider`, and `&suggestionsetup`.

Birthday maintenance runs through the existing recovered maintenance framework. Suggestions are persisted with anonymous mode, vote records, and staff status/comments.

### Setup entry points

`&welcomesetup`, `&giveawaysetup`, `&pollsetup`, and `&announcementsetup` open Discord-native setup entry panels with Configure, Preview, and Cancel actions. Existing legacy commands remain supported.

## Requirements

- Node.js 20 or newer
- pnpm 10
- A Discord bot application with the required gateway intents enabled:
  - Server Members Intent
  - Server Voice States Intent
  - Message Content Intent
- PostgreSQL
- An OpenAI API key if AI Support Assistant replies are wanted

## Edit with Acode on Android

The complete source package is structured for editing in the Acode Android editor. Open the extracted project root in Acode; do not open only the API subfolder. Acode is an editor, so run the bot through Termux for Android testing or deploy it to Railway for 24/7 hosting.

The full Android setup, Termux commands, environment configuration, PostgreSQL requirements, and Railway workflow are documented in [ACODE.md](./ACODE.md).

## Environment variables

Copy `.env.example` when running locally. In Railway, add these variables in the service Variables tab:

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Use the Railway PostgreSQL service reference value. |
| `DISCORD_BOT_TOKEN` | Yes | Token for the BH SHIELD Discord bot. |
| `OWNER_ID` | Yes | Discord User ID allowed to use the owner DM AI and receive status notifications. |
| `AI_PROVIDER` | Optional | Shared AI provider: `openai`, `gemini`, `claude`, or `groq`. |
| `AI_API_KEY` | Optional | Shared provider key. For OpenAI, `OPENAI_API_KEY` remains a compatibility fallback. |
| `AI_MODEL` | Optional | Shared model used by owner AI, server AI, ticket AI, and ticket summaries. |
| `AI_TIMEOUT` | Optional | Provider timeout in milliseconds. Defaults to 30000. `AI_TIMEOUT_MS` remains a legacy fallback. |
| `AI_MAX_HISTORY` | Optional | Maximum short-context messages per owner/channel scope. Defaults to 20. |
| `AI_MAX_TOKENS` | Optional | Maximum completion tokens. Defaults to 4096. |
| `AI_TEMPERATURE` | Optional | Sampling temperature. Defaults to 0.7. |
| `AI_MAX_REQUESTS_PER_MINUTE` | Optional | Shared AI request rate limit. Defaults to 10. |
| `AI_MAX_PENDING_REQUESTS` | Optional | Maximum queued/in-flight shared AI requests. Defaults to 3. |
| `AI_BASE_URL` | Provider-specific | Optional provider endpoint override. |
| `AI_OPENAI_BASE_URL` | OpenAI-compatible | Optional OpenAI endpoint override. |
| `AI_GEMINI_BASE_URL` | Gemini | Gemini API base URL; required because provider URLs are never hardcoded. |
| `AI_CLAUDE_BASE_URL` | Claude | Claude API base URL; required because provider URLs are never hardcoded. |
| `AI_GROQ_BASE_URL` | Groq | Groq API base URL; required because provider URLs are never hardcoded. |
| `OPENAI_API_KEY` | Optional | Compatibility fallback for `AI_PROVIDER=openai` when `AI_API_KEY` is empty. |
| `PORT` | Railway-provided | HTTP port used for the health check. Railway provides this automatically. |
| `NODE_ENV` | Recommended | Set to `production`. |
| `LOG_LEVEL` | Optional | Pino log level, such as `info`, `warn`, or `error`. |

Never commit real tokens, database credentials, or API keys.

## Deploy to Railway

### 1. Upload to GitHub

Extract the release ZIP and upload its contents to a new GitHub repository. Keep the repository root exactly as provided so Railway can detect the workspace and `railway.json`.

### 2. Create the Railway project

1. Create a new Railway project from the GitHub repository.
2. Add a Railway PostgreSQL service.
3. Add the variables listed above to the BH SHIELD service.
4. Set `DATABASE_URL` to the PostgreSQL service's connection string reference.
5. Deploy the service.

The included `railway.json` configures:

- Nixpacks build
- `pnpm run build:railway`
- `pnpm start`
- `/api/healthz` health checks
- Restart on failure with up to 10 retries

Voice moderation commands also require the Discord Server Voice States gateway intent to be enabled.

The production start command starts the API and Discord client without mutating the database. Apply the schema once with `pnpm run db:prepare` after the Railway PostgreSQL service is provisioned, then deploy or restart the bot. The application does not perform interactive schema changes during startup.

## Deploy to Heaven Cloud / Pterodactyl

Use the project root as the server directory. The project supports both pnpm and npm workspace installation. pnpm is preferred because it uses the committed lockfile, but npm can install the declared workspaces when the panel does not allow changing its installer.

Set the server's install command to:

```bash
corepack enable && pnpm install --frozen-lockfile
```

If Heaven Cloud forces npm, use:

```bash
npm install
```

Set the build command to:

```bash
pnpm run build
```

Set the startup command to:

```bash
pnpm start
```

The startup command runs `artifacts/api-server/dist/index.mjs`, which is generated by the build. Do not use `node ./index.js` or `node ./dist/index.js`; those files are not this project's entrypoint.

Use the Node.js 20 image and set `PORT` to the port assigned by the panel. The required runtime variables are `DATABASE_URL`, `DISCORD_BOT_TOKEN`, and `OWNER_ID`. AI is optional; configure `AI_PROVIDER` plus `AI_API_KEY` (or `OPENAI_API_KEY` for the existing OpenAI compatibility fallback) when AI features are wanted. The complete variable list is in the Environment variables table above.

### 3. Invite the bot

Invite the bot to each server with the permissions required to manage ticket channels, messages, embeds, attachments, and members. The bot must also have the gateway intents listed in the Requirements section enabled in the Discord Developer Portal.

### 4. Create the first panel

Inside an administrator channel, run:

```text
&panel create
```

Use the interactive setup dashboard to configure the panel. Nothing is published until **Publish** is pressed. Required fields are validated before publishing.

## Local installation and production test

```bash
pnpm install
cp .env.example .env
# Fill in the environment variables without committing .env.
# Export them in your shell before starting (Node does not load .env automatically):
set -a
source .env
set +a
pnpm run db:prepare
pnpm build
pnpm start
```

The service listens on `PORT` and exposes:

```text
GET /api/healthz
```

Expected response:

```json
{"status":"ok"}
```

The `pnpm start` command is the same production command configured for Railway.

## Project structure

```text
artifacts/api-server/   Express health server and Discord bot
lib/db/                 Drizzle schema and PostgreSQL access
lib/api-zod/            Shared API validation types
lib/api-spec/           OpenAPI package
lib/api-client-react/   Shared generated API client package
scripts/                Workspace utility scripts
railway.json            Railway build, start, health, and restart config
.env.example            Safe environment variable template
```

## Reliability and updates

- Discord.js automatically reconnects the gateway after temporary network interruptions.
- Gateway disconnects, reconnect attempts, shard errors, client errors, and successful resumes are logged.
- The process fails fast with a clear log when `DATABASE_URL`, `DISCORD_BOT_TOKEN`, or `OWNER_ID` is missing.
- Uncaught exceptions, unhandled promise rejections, Node warnings, Discord gateway errors, and PostgreSQL pool errors are logged before shutdown or retry.
- Ticket numbers are reserved atomically per panel, and each ticket can receive only one persisted review.
- Railway restarts the service when the process exits unexpectedly.
- Database-backed settings and ticket data persist across restarts.
- Each stable release includes a complete source ZIP, version, changelog, and validation report.

For a future update, replace the repository contents with the new release package and redeploy. Do not overwrite the Railway variables.

## Owner AI and status notifications

The owner assistant works only in direct messages from the configured `OWNER_ID`. Server messages, server interactions, slash commands, and ticket conversations cannot invoke it. Other DM users receive an authorization denial. The existing ticket Support Assistant remains separate and continues to operate inside ticket channels.

Owner status alerts are delivered as embeds to `OWNER_ID` after Discord is ready. They include runtime health data and never include API keys or secret values.

### Owner DM live logging

The owner can enable private, real-time operational logs from any server where the bot is installed:

```text
&dmlogs on
&dmlogs off
&dmlogs status
&dmlogs test
```

Only the Discord user matching `OWNER_ID` can control this system or receive its log DMs. Logging is disabled by default. Its setting, bounded queue, category filters, and last-delivery time are stored in PostgreSQL. Failed deliveries are retried asynchronously without blocking ticket or moderation actions.

## Owner modes and custom prefixes

Each server can use its own prefix. The default is `&`.

```text
&setprefix !
&prefix
&resetprefix
```

Only the server owner or an administrator can change the prefix. The Help Center automatically displays the active server prefix.

The configured owner can enable private owner modes:

```text
&ghostmode on
&ghostmode off
&ghostmode status

&noprefix on
&noprefix off
&noprefix status
```

Ghost Mode re-sends ordinary owner messages through BH SHIELD while leaving commands, management messages, bot messages, system messages, and other users untouched. `OWNER_ID` always has permanent No Prefix access, while additional users can be granted global No Prefix access by the owner. Ghost Mode remains disabled by default and its server setting is persisted in PostgreSQL.

## Moderation commands

All moderation commands use the `&` prefix and require the relevant Discord permission, configured moderator role, or administrator access. The bot checks role hierarchy before member actions.

```text
&ban &unban &kick &mute &unmute &timeout &untimeout &warn &warnings &clearwarnings
&softban &tempban &tempmute
&purge &clear &slowmode &lock &unlock &lockdown &unlockdown &nuke &clone
&nick &resetnick &userinfo &avatar &serverinfo &role &removerole
&voicekick &voicemute &voiceunmute &deafen &undeafen &move
&automod &antispam &antilink &antiinvite &badwords &capsfilter &mentionlimit &raidmode
&modlogs &case &cases &history
&say &embed &announce &poll
&setlog &setmodrole &setmuterole &config
&reload &restart &shutdown &eval &sync
```

Examples:

```text
&tempban @member 1d repeated spam
&tempmute @member 30m disruptive behavior
&automod antilink on
&badwords add prohibited-word
&mentionlimit 5
&setlog #moderation-logs
&setmodrole @Moderators
&setmuterole @Muted
```

## Utility commands

All utility commands use the active server prefix. Announcement, DM announcement, auto-reply, and giveaway administration requires Manage Server or Administrator. Polls can be created by members and managed by moderators.

```text
&announce #channel Message | title=Title | description=Details | color=#5865f2 | image=https://... | thumbnail=https://... | footer=BlackHeart | ping=yes
&announce Welcome | mode=text

&dmannounce @everyone Server update
&dmannounce @Moderators Staff meeting at 8 PM
&dmannounce @Member1 @Member2 Please check your DMs

&autoreply add "hello" "Hello! Welcome to the server."
&autoreply remove "hello"
&autoreply list
&autoreply clear
&autoreply info "hello"

&gstart 1h | Nitro | 1 | @RequiredRole
&gend <giveaway-id>
&greroll <giveaway-id>
&gpause <giveaway-id>
&gresume <giveaway-id>
&gdelete <giveaway-id>
&glist

&poll Favourite colour? | Red | Blue | Green | timed:1h | anonymous
&poll end <poll-id>
&poll results <poll-id>
```

Giveaways include persistent entries, optional required roles, automatic expiry, winner selection, pause/resume, end, delete, and reroll actions. Polls support up to ten choices, live button vote counts, changeable votes, anonymous display mode, timed expiry, and result inspection.

## Owner DM commands and permanent No Prefix

The configured `OWNER_ID` can use every recognized prefix command in the bot's DMs. The owner can use either the normal prefix or no prefix:

```text
help
ping
userinfo
serverinfo
ticket setup
announce
dmannounce
poll
reload
```

Commands that require a server return a clear server-context message instead of failing. Normal owner DM conversation continues to the private AI assistant.

The owner always has permanent No Prefix access and cannot disable or remove it. Only the owner can manage additional global No Prefix users:

```text
&noprefix add @user
&noprefix remove @user
&noprefix list
&noprefix info @user
```

Additional No Prefix users can run recognized commands without the configured server prefix. They cannot manage No Prefix permissions or use owner-only commands. No Prefix changes and no-prefix command executions are sent to the existing owner DM logging system.

## Secure Owner Help category

The Help Center includes an `👑 Owner` category in its dropdown. The category is rendered with a viewer-specific permission check:

- Only the configured `OWNER_ID` can view owner command names, descriptions, usage, aliases, or required permissions.
- Other users receive only a generic `🔒 Access Denied` embed and no owner command metadata.
- Owner command entries are generated from the runtime command registry's `ownerOnly` metadata.
- `ghostmode on|off|status`, `dmlogs`, `noprefix`, restart controls, and every other registered owner-only command appear automatically.
- A future command registered with `ownerOnly: true` is included without changing the Help Panel.

The existing public Help Center categories, Invite button, custom prefixes, universal command router, and owner DM system remain unchanged.

## Universal command registry

BH SHIELD uses one runtime command registry for message parsing and execution. The DM handler and server handler do not maintain separate command-name lists. A registered command is automatically available through:

- The default `&` prefix
- A server's custom prefix
- Permanent owner No Prefix
- Owner DM command execution
- Server-context validation and owner-only permission checks

New command modules should register themselves once:

```ts
import { registerCommand } from "./lib/command-registry";

registerCommand({
  name: "status",
  aliases: ["state"],
  execute: async (message, args, context) => {
    await message.reply(`Status requested by ${message.author.tag}.`);
  },
});
```

After registration, no parser, DM handler, No Prefix list, or prefix-specific code needs to be changed. The router resolves the command from the registry at runtime. Commands marked `guildOnly` receive a clear server-context response in DMs, and commands marked `ownerOnly` remain protected.

## Owner AI conversation and DM command troubleshooting

Owner DM commands are routed before AI fallback. The bot subscribes to Discord direct-message events and partial DM channels, so the owner can use either the normal prefix or permanent No Prefix:

```text
&help
help
&ping
ping
```

If a command requires a server, the bot replies with a server-context explanation instead of crashing. Any owner DM that is not a registered command continues to the private conversational AI assistant. Non-owner DM messages receive `You are not authorized to use this AI.`.

The owner AI is always available in the owner's DMs whenever the shared provider is configured; it cannot be disabled by a server setting. Server AI is disabled by default in every channel. An administrator with Manage Server or Administrator permission can run `&ai on`, `&ai off`, or `&ai status` in an individual channel. Enabled channels are stored in PostgreSQL, and multiple channels can be enabled independently.

All AI surfaces use the same environment-driven provider, bounded short history, serialized queue, rate limit, timeout, transient retry policy, token limits, and temperature. Provider errors preserve the exact sanitized message and HTTP status internally, are sent through the Owner DM Logging System, and produce a helpful user-facing response instead of crashing the bot. AI logs include provider, response time, and token usage when returned.

## Database diagnostics and recovery

BH SHIELD treats the Drizzle schema as the source of truth and verifies the connected PostgreSQL catalog at startup without running DDL. The verifier checks expected tables, columns, indexes, foreign keys, and the full-row `bh_guild_settings` query.

Database changes are applied through the supported development schema flow:

```bash
pnpm run db:prepare
```

Production schema changes must be promoted through the deployment/publish flow. BH SHIELD never modifies database schema automatically at runtime. Recoverable connection errors use bounded retries with health probes and backoff; schema drift is logged as an actionable failure and sent to the owner instead of being “fixed” unsafely.

All command, Discord event, and scheduled maintenance boundaries isolate failures. Recovery logs include the category, full error and stack trace, timestamp, guild/user/channel context, action, attempt, and success/failure result.

## Validation for version 1.0.31

This release was verified with:

- Database schema consistency check, including duplicate-review detection
- Workspace TypeScript typecheck
- API production build using the Railway build command
- Full workspace build with the preview artifact's required build variables
- Railway production start command
- HTTP health check
- Discord client startup
- Direct-message gateway intent and DM channel partial configuration
- Owner command routing before AI fallback
- Secure owner-only Help category rendering and unauthorized access denial
- Git whitespace validation
- Saved-reply, duplicate-ticket, AI-summary, and SLA integration checks
- Moderation schema synchronization, typecheck, command routing, permissions, hierarchy checks, automod, voice intent, and temporary-action expiry checks
- Read-only catalog verification of 37 tables, 427 expected columns, and 70 indexes
- Full-row `bh_guild_settings` query verification after schema synchronization
- Recovery retry, isolation, deduplication, and owner-notification paths
- Shared AI provider selection, exact provider error reporting, modern OpenAI token parameters, and server AI channel persistence

## License

MIT