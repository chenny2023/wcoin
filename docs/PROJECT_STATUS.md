# WCOIN.CASINO — Project Status & Progress Archive

> Living status snapshot for continued iteration & expansion. Last updated: 2026-06-24.
> Complements `docs/ARCHITECTURE_REVIEW.md` (how it's built) and `docs/PRODUCT_INVENTORY.md` (what features exist).
> This doc = current state + recent major work + known issues + roadmap.

---

## 1. What WCOIN.CASINO is

An independent, **open** on-chain intelligence **data-media** platform for the crypto-casino industry — **not an operator, not an affiliate that sells rankings**. Core asset = live on-chain data (tracked deposit/withdrawal volume, all-chain proof-of-reserves, net flow), independent trust ratings, streamer activity, and social/risk signals. Output = public SEO pages (server-rendered) + a public live dashboard + a daily/monthly email report.

**Strategic moat:** unique on-chain data competitors can't replicate (Google "information gain") + trust-first ranking + YMYL legal-defensible posture. SEO liability avoided: thin/programmatic AI content is gated.

---

## 2. Stack & deployment

- **Backend:** Fastify v5 + better-sqlite3 (SYNCHRONOUS, single-thread — the core perf constraint; heavy writes MUST chunk+yield), `tsx` runtime. ~8GB SQLite on a Railway volume; litestream → R2 continuous backup.
- **Frontend:** React + Vite + Tailwind SPA. Server-rendered SEO pages (`server/src/seo.ts` → `seo_page` table) are served *ahead of* the SPA so crawlers get real HTML.
- **Hosting:** Railway (behind Cloudflare). **Deploy = `railway up` from the repo root** (uploads the working tree; GitHub auto-deploy is unreliable — see Known Issues). After any frontend deploy, verify `grep -c RequireAuth src/App.tsx` == 0 (open-access invariant).
- **Network:** dev box behind the GFW (proxy 127.0.0.1:7890 for open-web; chain RPCs go direct). Railway is outside the GFW (collectors fetch direct).

---

## 3. Capabilities (current)

### On-chain data collection (`server/src/collectors/`)
- **EVM** (`evm.ts`, `evmchains.ts`, `native.ts`, `backfill.ts`): ETH + multi-EVM (BSC, Polygon, Base, Arbitrum, Optimism, Avalanche) casino-wallet transfer indexing.
- **Tron** (`tronrpc.ts`, `tron.ts`): TRC20 (USDT) — the dominant stablecoin deposit rail. 32 named Tron casinos tracked (~$660M/7d incl. Stake $300M).
- **UTXO** (`utxo.ts`): BTC + LTC via Esplora (blockstream). 219 BTC casino addresses. ⚠️ see Known Issues (blockstream rate-limit throttles big-wallet backfill).
- **Solana / XRP** (`solana.ts`, `xrp.ts`).
- **Labels/attribution** (`labels.ts`): curated hot-wallet labels (Etherscan/Tronscan public name-tags) + EVM label dumps + Tron tag harvest + behavioural "Casino-pattern" graph discovery (`discoverServices`/`classifyServices`). Claimed ≠ verified is a hard rule.
- **Arkham** (`arkham.ts`): authoritative cross-chain attribution. 33 casinos → entities. `/portfolio` (non-429) gives per-chain **reserves** → the daily report's "Reserves by chain". `/transfers` (per-chain volume) is permanently 429 on the free tier (see Roadmap: Arkham Pro).

### Derived products
- **Reserves / proof-of-reserves** (`reservehistory.ts`, `arkham.ts`).
- **Trust ranking** (blended third-party ratings, never volume).
- **Risk registry** (`risk.ts`, `riskevents.ts`) — auto on-chain signals, neutral.
- **Daily/weekly market snapshot** (`snapshot.ts`) → report + email + SEO.
- **Streamers** (`twitch.ts`, `kick.ts`, `youtube.ts`, `streamerprofiles.ts`) — Kick/Twitch/YouTube gambling streamers + affiliation.
- **Sentiment / social** (`reddit.ts`, `bitcointalk.ts`, `gdelt.ts`, `news.ts`, etc.).
- **Casino directory** (`directory.ts`, `guruspider.ts`) — casino.guru spider + Trustpilot (paid unlocker).

### Surfaces
- **Public SEO layer** (`seo.ts`): ~350+ server-rendered pages — `/casino/*`, `/compare/*` (C(18,2)=153), `/rankings/*`, `/chains/*`, `/reports/daily|weekly/*`, `/proof-of-reserves`, `/risk`, `/methodology/*`, `/streamers` + `/streamer/*`, `/about`, `/responsible-gambling`, `/insights`, `/best-crypto-casinos`, `/submit/casino|kol`. Lifecycle-gated; `<lastmod>` + IndexNow.
- **Public dashboard** (`/app/*`, no login): Overview, Casinos, Directory, Markets, Blockchain, Streamers, Trust&Reserves, Flow Intel, Email Alerts, Reports.
- **Email** (`subscribe.ts`, `casinoalert.ts`, `digest.ts`): daily/monthly digest + per-casino reserve alerts (no login, double opt-in).
- **Internal ops panel** (`server/src/internal/`, `/internal/social`): competitor/demand monitor + draft generation for wonix/hirecx/wcoin — **admin/team-gated, draft-only**.

---

## 4. Major work this session (2026-06-24)

1. **Open-access transformation** — removed the login gate entirely; all data public; email collected only at subscribe points; X auto-publish pipeline deleted; watchlist→email "Casino Alerts"; site-wide subscribe + 18+/responsible-gambling/correction footer. (See memory `open-access-model.md`.)
2. **Chain-distribution credibility** — daily report now leads with **authoritative Arkham "Reserves by chain"** (ETH 55% / SOL 20% / TRON 12% / BSC 9% / BTC 0.6% …) instead of coverage-skewed indexed volume.
3. **On-chain data fixes** — BTC indexer pagination + resumable backfill (was capturing ~0.5% of casino flow); Tron casino-flow stat + key-classified service discovery; per-chain reserves capture.
4. **SEO upgrade spec (P0–P2) fully implemented** — timestamps (`article:modified_time` + visible "Last updated"), Dataset/ItemList/FAQ/Breadcrumb schema (no Review/AggregateRating), rolling-year titles, thin-content word-count gate, E-E-A-T (`/about`) + YMYL (`/responsible-gambling`, 18+, not-endorsement) + `/insights` + `/best-crypto-casinos` hub + hreflang skeleton + `/submit/*` pages. On-site SEO assessed ≈ **8.6/10**.
5. **IndexNow** — pushes the indexable set to Bing/Yandex on each SEO rebuild.
6. **Form parsing fix** — registered an x-www-form-urlencoded parser; the SSR email subscribe/alert forms were silently 415-ing (email capture wasn't actually working).

---

## 5. Current live state

- Site healthy: `/api/health` ok, backfill 100%, ~14d history, ~52M transfers indexed, read-worker on.
- Sitemap: ~351 indexable URLs (was 177 pre-session). The last batch (hub + `/submit/*` + hreflang) is deployed but pending an uninterrupted SEO-regen window (see Known Issues).

---

## 6. Known issues / operational gotchas

1. **Automated internal tooling churns the repo & restarts the service.** A background process (the social-intel/"产品观察室" tooling) auto-commits `feat(internal): …` and runs its own `railway up`. Side-effects observed: (a) reverts `src/App.tsx` (re-adds the login gate/Login import) — ALWAYS `grep -c RequireAuth src/App.tsx` before a frontend deploy; (b) frequent restarts starve the 210s-after-boot SEO regen, so new SEO pages can lag until a ~3.5-min uninterrupted window. Not a code bug. **User has chosen not to disable it for now.**
2. **BTC big-wallet backfill is rate-limited.** blockstream's free Esplora throttles the paginated backfill, so the largest wallets (e.g. CSGOEmpire, ~$85M/7d real) creep up slowly ($388k→$913k so far). Mechanism is correct (resumable, restart-robust, cooldown); the bottleneck is the free data source. Real fix = a different/paid BTC source (self-host Esplora, mempool.space, or Arkham Pro).
3. **Cloudflare cache overrides origin headers.** CF caches responses (incl. `no-store` 404s and SSE) against origin intent — serves stale 404s for newly-generated SEO pages, slowing crawl discovery. Fix is in the CF dashboard (cache rule respect origin / bypass dynamic SEO routes), not code.
4. **Tron/BTC per-address *volume* attribution is blocked without paid data.** Tronscan tags don't cover casinos; Arkham address/transfers endpoints are 429 on the free tier. The credible cross-chain picture uses **reserves** (Arkham portfolio) instead.

---

## 7. Pending / external actions (user-side)

- ✅ GSC sitemap submission — user reports done.
- ✅ §4.4 disclaimer wording — user confirmed OK (no legal-review blocker).
- ⏳ Cloudflare cache rule fix (see Known Issues #3).

---

## 8. Roadmap / expansion directions

- **Off-page / backlinks** — the next ranking frontier (on-site is ~8.6/10; out of this session's scope). A data site is well-suited to earn citations/links (data PR, embeddable stats).
- **Named-author / byline** on data pages → E-E-A-T from org-level to person-level (§4.1).
- **Arkham Pro (~$999/mo, available ~1 month out)** — unblocks per-chain casino *volume* + address harvesting across all chains. Code (`entityVolume7d`, `arkham_chain_volume`) is already written to consume it.
- **Better BTC data source** — to capture the (large, real) BTC casino flow that blockstream's rate limit currently throttles.
- **More public SSR landing pages** — token/asset pages ("Bitcoin/USDT Casinos"), per-casino proof-of-reserves pages, sentiment pages.
- **i18n** — hreflang skeleton is in place; add locales when ready (no route-layer change needed).
- **Tame the internal tooling** — if its repo churn / restarts become costly, gate or schedule it (see Known Issues #1).

---

## 9. Key memory pointers (for future agents)

`open-access-model.md` · `seo-content-layer.md` · `btc-tron-attribution.md` · `railway-deployment.md` · `data-credibility-first.md` · `rankings-trust-first.md` · `social-intel-tool.md` · `communicate-in-chinese.md`.
