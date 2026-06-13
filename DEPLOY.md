# Deploying WCOIN.CASINO to Railway

One platform, one process: the Fastify server runs the API, all on-chain
indexers/collectors, and serves the built React SPA. No Vercel needed (Vercel
is serverless + ephemeral-FS and cannot run the long-lived indexers or persist
the SQLite database).

The repo already contains everything Railway needs: `Dockerfile`, `railway.json`
(Dockerfile builder + `/api/health` healthcheck), and `.dockerignore` (keeps the
5.4 GB local DB and your `.env` secrets out of the image).

## One-time setup (≈5 minutes)

### 1. Push the repo to GitHub
The project is a local git repo with no remote yet. Create an **empty private**
repo on GitHub, then:
```bash
git remote add origin https://github.com/<you>/wcoin-casino.git
git push -u origin master
```

### 2. Create the Railway project
- Railway → **New Project → Deploy from GitHub repo**.
- When it asks for GitHub access, choose **"Only select repositories" → just
  `wcoin-casino`**. This keeps your other projects completely invisible to
  Railway. ⚠️ Do not grant "All repositories".
- Railway auto-detects `railway.json` → builds with the Dockerfile.

### 3. Add a persistent volume (REQUIRED)
Without this, the SQLite DB is wiped on every redeploy.
- Service → **Variables/Settings → Volumes → New Volume**
- Mount path: **`/app/server/data`**
- Size: start at **10 GB** (the DB is ~5.4 GB locally and grows).

### 4. Set environment variables
Service → **Variables**. Do NOT commit these; set them here.

| Variable | Value | Notes |
|---|---|---|
| `DB_PATH` | `/app/server/data/wcoin.db` | already set in Dockerfile, override only if you change the mount |
| `EVM_RPC` | your Alchemy/Infura ETH RPC URL | from your local `.env` |
| `TRON_JSONRPC` | your GetBlock TRON JSON-RPC URL | from your local `.env` |
| `RESEND_API_KEY` | your Resend API key | **required for public sign-up** — sends the email verification codes (see below) |
| `RESEND_FROM` | `WCOIN.CASINO <login@yourdomain.com>` | a verified Resend sender; defaults to the shared `onboarding@resend.dev` which only delivers to the account owner |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | optional | enables Twitch streamers |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | optional | enables Reddit mentions |

### Email verification codes (free passwordless sign-in)

The product is 100% free: visitors sign up with just an email + a 6-digit code —
no password, no payment. The code is sent via the [Resend](https://resend.com)
HTTP API (free tier ≈ 3,000 emails/mo, no card).

1. Create a Resend account, add + verify your sending domain, and create an API key.
2. Set `RESEND_API_KEY` and `RESEND_FROM` (a sender on your verified domain).

Without `RESEND_API_KEY` the server still works but **only logs the code to the
console** (and never returns it in production) — so nobody can complete sign-up
on the live site until the key is set. Locally (`NODE_ENV != production`) the code
is also returned in the API response so the flow is testable without email.

**Do NOT set `HTTP_PROXY`/`HTTPS_PROXY`** — there is no GFW on Railway, so the
collectors must fetch the open web directly (the code already handles a missing
proxy).

`PORT` is injected by Railway automatically — leave it unset.

### 5. Deploy & expose
- Railway builds and starts the service. Healthcheck hits `/api/health`.
- Service → **Settings → Networking → Generate Domain** for a public URL.

## After first deploy

- **Fresh database.** The cloud instance starts with an empty DB and re-indexes
  from scratch — the deep backfill walks ~30 days × 12 chains over several hours
  and consumes RPC quota. To skip that, upload your local
  `server/data/wcoin.db` (+ `-wal`, `-shm`) into the volume once.
- **Memory.** Aggregations scan millions of rows; if the service OOMs, bump the
  instance RAM (Railway → service resources). 1–2 GB is comfortable.
- **Cost.** This app is always-on and RPC-heavy; expect to exceed Railway's free
  $5 credit. Budget ~$5–20/mo depending on resources + the volume.

## Optional: split frontend to Vercel
Not necessary — the server already serves the SPA. If you ever want a CDN-backed
frontend, build with `npm run build`, deploy `dist/` to Vercel, and point its
API calls at the Railway domain. The backend still must live on Railway/a VPS.
