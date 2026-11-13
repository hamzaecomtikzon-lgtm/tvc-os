# Kreo backend

Node 22.13+ and one dependency (the Anthropic SDK, only used by the optional chat manager).
Data is stored in SQLite; the Discord bot talks to Discord directly.

## Run it

```bash
cd backend
npm install
cp .env.example .env      # first time only, then fill it in
npm start                 # API on http://localhost:8787
```

In another terminal: `cd frontend && npm run dev`. The dev server forwards `/api` to the backend.

## Connect Discord

1. https://discord.com/developers/applications → your application → **Bot** → **Reset Token** → copy it.
2. Put it in `backend/.env` as `DISCORD_BOT_TOKEN=...` (never in `.env.example`, which is committed).
3. On the same Bot page, under **Privileged Gateway Intents**, turn on:
   - **Server Members Intent**: lets the bot see who joins (welcome DMs) and list members (analytics).
   - **Message Content Intent**: only needed for the general chat manager to read messages that don't @mention it.
4. Restart the backend. It prints which of these are on.

The invite link in the app (setup step 1, or Settings → Bot & server) adds the bot to a server.

## Optional: Continue with Google

1. https://console.cloud.google.com/apis/credentials → **Create credentials** → **OAuth client ID** → type **Web application**.
   (Google asks you to fill in the consent screen first: app name and your email are enough.)
2. Under **Authorized redirect URIs** add `http://localhost:5173/api/auth/google/callback`
   (use your real site address instead of `localhost:5173` once it is hosted).
3. Copy the client ID and secret into `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the backend.

Until then the button is shown but tells the person that Google sign-in isn't set up.

## Optional: general chat manager

Add `ANTHROPIC_API_KEY=...` to `backend/.env`. Without it the chat manager stays silent and everything else works.

## What is live and what is sample data

| Part | Source |
|---|---|
| Accounts, team members, settings, drafts, DMs, analytics counters | SQLite (`backend/data/kreo.db`) |
| Servers, channels, members, nickname, creating channels, posting, reactions, DMs | Discord, live |
| Member joins, DM replies, messages, reactions, voice time | Discord gateway, counted from the moment the backend is running |
| Sales, videos, products, creator email/phone | **Sample data** from `src/sampleData.js`. `src/crm.js` is the one file to replace with real Cruva / Euka / Reacher calls |
| Email notifications, billing | Not built |

## The database

One SQLite file, `backend/data/kreo.db` (change it with `DATABASE_FILE`). Tables:

- `users`: accounts. `workspace_id` is set for invited team members (they share the owner's data); `role` is Owner, Admin, Moderator or Viewer.
- `sessions`: sign-in sessions (only a hash of the cookie is stored).
- `invites`: emails invited to a workspace that haven't signed up yet.
- `docs`: everything else, one JSON document per row: `ns` (the workspace), `path` (like `drafts/abc`), `doc` (JSON).

Look inside with any SQLite tool, for example:

```bash
sqlite3 backend/data/kreo.db "SELECT path FROM docs"
sqlite3 backend/data/kreo.db "SELECT email, role FROM users"
```

Document paths: `workspace/main`, `discord/<server>`, `members/<server>`, `config/<server>`, `automations/<server>`,
`custom/<id>`, `onboarding/<server>`, `scoring/<server>`, `drafts/<id>`, `dms/<discord user>`, `activity/<server>_<date>`.

## Files

- `src/server.js`: HTTP routes. `src/auth.js`: accounts, sessions, team. `src/store.js`: SQLite.
- `src/discord.js`: Discord REST calls. `src/gateway.js`: the live connection. `src/bot.js`: what happens on each live event.
- `src/jobs.js`: sync, drafts, posting, DMs, and the schedule. `src/drafts.js`: the text of each automation.
- `src/crm.js`, `src/sampleData.js`: CRM data (sample). `src/ai.js`: chat manager replies.
