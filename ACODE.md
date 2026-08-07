# BH SHIELD with Acode on Android

This project is fully editable in the Acode app. Acode is the editor; the bot process must run in Termux on Android or on Railway for 24/7 hosting.

## Open the project in Acode

1. Download and extract the complete BH SHIELD ZIP.
2. Open the extracted project folder in Acode.
3. Keep the project root intact. The root must contain `package.json`, `pnpm-workspace.yaml`, `README.md`, and `railway.json`.
4. Edit TypeScript files normally. The main Discord bot is in `artifacts/api-server/src/lib/discord-bot.ts`.
5. Never place real tokens or database credentials in source files.

## Run on Android with Termux

Install Termux from a trusted source such as F-Droid, then run:

```bash
pkg update
pkg install nodejs-lts git
corepack enable
corepack prepare pnpm@10.26.1 --activate
```

Move or clone the project into Termux storage, then:

```bash
cd /path/to/BH-SHIELD
pnpm install
cp .env.example .env
```

Open `.env` in Acode and set:

```env
DATABASE_URL=your-postgresql-connection-string
DISCORD_BOT_TOKEN=your-discord-bot-token
OWNER_ID=your-discord-user-id
AI_PROVIDER=openai
AI_API_KEY=
AI_MODEL=gpt-4o-mini
OPENAI_API_KEY=your-openai-key
BH_SHIELD_AI_MODEL=gpt-4o-mini
```

`OWNER_ID` is required for owner notifications and the owner-only DM assistant. `OPENAI_API_KEY` enables the ticket Support Assistant and can back the owner AI when `AI_PROVIDER=openai`. Do not commit `.env` or share it.

The project needs a reachable PostgreSQL database. For Android testing, use a hosted PostgreSQL connection such as the database attached to Railway. The database must be reachable from the Android network.

Validate and build:

```bash
pnpm run db:prepare
pnpm run typecheck
pnpm run build:railway
```

Start the bot:

```bash
pnpm start
```

The bot starts the health server and Discord client. Keep the Termux session active, or use a Termux process manager for local testing. For reliable 24/7 operation, deploy the same project to Railway.

## Edit in Acode and deploy with Railway

1. Edit and save files in Acode.
2. Upload the project to GitHub, preserving the repository root.
3. Connect the repository to Railway.
4. Add `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `OWNER_ID`, and the desired AI variables in Railway Variables. `OPENAI_API_KEY` can power both the ticket assistant and the owner AI when `AI_PROVIDER=openai`.
5. Railway uses the included `railway.json` build command and `pnpm start` production command.

## Android editing notes

- Use the workspace root, not a nested `artifacts/api-server` folder, when installing dependencies.
- Keep `pnpm-lock.yaml` synchronized when dependencies change.
- Do not delete `pnpm-workspace.yaml`; the database and API server are workspace packages.
- Do not edit generated `dist` files. They are rebuilt by `pnpm run build:railway`.
- If Acode shows unresolved imports before dependencies are installed, run `pnpm install` from Termux.
- Discord gateway access and PostgreSQL access require an internet connection.

## Safe files

The release includes `.env.example`, which contains placeholders only. Real secrets are intentionally not included in the source package.