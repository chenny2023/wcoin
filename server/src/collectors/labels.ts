import { db, stmt, stateGet, stateSet } from '../db.ts'
import { webFetch } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Casino-wallet attribution harvester. Collects REAL public labels:
//
//  • ETH  — Etherscan's "gambling" account labels, via the maintained public
//           dump at github.com/brianleect/etherscan-labels (45+ casinos:
//           1xBet, Bitsler, Parlay, etc.). Source of truth: Etherscan label cloud.
//  • TRON — Tronscan's public `addressTag` field, harvested from the top USDT
//           holder list (keyless API). Tags are classified into casino /
//           exchange by keyword; unknown tags are skipped, never guessed.
//
// Runs on boot (max once per REFRESH_DAYS) and adds entries to the same
// watchlist the indexer consumes — so every harvested casino wallet starts
// accruing real transfer history immediately.
// ─────────────────────────────────────────────────────────────────────────────

const ETH_GAMBLING_URL =
  'https://raw.githubusercontent.com/brianleect/etherscan-labels/main/data/etherscan/accounts/gambling.json'
const TRON_HOLDERS_URL =
  'https://apilist.tronscanapi.com/api/token_trc20/holders?contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

const REFRESH_DAYS = 7
const TRON_PAGES = 20 // top 20 × 50 = 1000 holders scanned
const PAGE_SIZE = 50

const GAMBLING_RE = /casino|gambl|bet(?!a)|stake|dice|slots?|poker|lottery|lotto|jackpot|roobet|rollbit|bitsler|wager|1xbet|bovada|fortunejack/i
const EXCHANGE_RE = /binance|okx|okex|huobi|htx|bybit|kraken|coinbase|kucoin|gate\.io|bitfinex|mexc|bitget|crypto\.com|upbit|bithumb|exchange/i
const SKIP_RE = /tether|treasury|justlend|foundation|usdd|wrapped|multisig|burn/i

function cleanLabel(raw: string): string {
  // "Bitsler.com: USDT" → "Bitsler.com" ; keep names tight
  return raw.split(':')[0].trim().slice(0, 48)
}

async function harvestEthGambling(): Promise<number> {
  const res = await webFetch(ETH_GAMBLING_URL, { signal: AbortSignal.timeout(25_000) })
  if (!res.ok) throw new Error(`labels dump HTTP ${res.status}`)
  const json = (await res.json()) as Record<string, string>
  const now = Date.now()
  let added = 0
  const tx = db.transaction(() => {
    for (const [address, name] of Object.entries(json)) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) continue
      const r = stmt.addWatch.run('ETH', address.toLowerCase(), cleanLabel(name), 'casino', now)
      added += r.changes
    }
  })
  tx()
  return added
}

async function harvestTronTags(): Promise<number> {
  const now = Date.now()
  let added = 0
  for (let page = 0; page < TRON_PAGES; page++) {
    try {
      const res = await fetch(`${TRON_HOLDERS_URL}&start=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      for (const h of json.trc20_tokens ?? []) {
        const tag: string = h.addressTag ?? ''
        const addr: string = h.holder_address ?? ''
        if (!tag || !addr || SKIP_RE.test(tag)) continue
        let category: string | null = null
        if (GAMBLING_RE.test(tag)) category = 'casino'
        else if (EXCHANGE_RE.test(tag)) category = 'exchange'
        if (!category) continue // unknown tag → never guess
        const r = stmt.addWatch.run('TRON', addr, cleanLabel(tag), category, now)
        added += r.changes
      }
    } catch (e) {
      console.warn(`[labels] tron page ${page} failed:`, (e as Error).message)
    }
    await new Promise((r) => setTimeout(r, 1200)) // keyless API politeness
  }
  return added
}

// ── Service discovery from our own transfer graph ────────────────────────────
// Public explorers no longer expose tag lookups keylessly, so unknown casino /
// payment-processor hot wallets can't be named from outside. What our REAL
// data does show: counterparties that transact with MANY watched entities at
// high frequency are services, not players. We watch the top ones under an
// honest "Service <addr>" label (category 'other') so the indexer builds their
// full flow profile — operators rename them via the Watchlist when identified.
const DISCOVER_WINDOW_DAYS = 7
const DISCOVER_MIN_TX = 300 // observed transfers in window
const DISCOVER_MIN_PEERS = 3 // distinct watched entities touched
const DISCOVER_MAX_PER_CHAIN = 10

export function discoverServices(): number {
  const since = Date.now() - DISCOVER_WINDOW_DAYS * 86_400_000
  const now = Date.now()
  let added = 0
  for (const chain of ['ETH', 'TRON'] as const) {
    const slots =
      DISCOVER_MAX_PER_CHAIN -
      ((db.prepare("SELECT COUNT(*) n FROM watchlist WHERE active=1 AND chain=? AND label LIKE 'Service %'").get(chain) as any).n as number)
    if (slots <= 0) continue
    const rows = db
      .prepare(
        `SELECT t.counterparty AS addr, COUNT(*) AS tx, COUNT(DISTINCT t.watch_id) AS peers
         FROM transfers t
         WHERE t.chain = ? AND t.ts >= ?
           AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.chain = t.chain AND w.address = t.counterparty)
         GROUP BY t.counterparty
         HAVING tx >= ? AND peers >= ?
         ORDER BY tx DESC LIMIT ?`,
      )
      .all(chain, since, DISCOVER_MIN_TX, DISCOVER_MIN_PEERS, slots) as { addr: string; tx: number; peers: number }[]
    for (const r of rows) {
      const short = `${r.addr.slice(0, 8)}…${r.addr.slice(-6)}`
      const res = stmt.addWatch.run(chain, r.addr, `Service ${short}`, 'other', now)
      if (res.changes) {
        added += res.changes
        console.log(`[labels] discovered ${chain} service ${short} (${r.tx} tx / ${r.peers} watched peers, 7d)`)
      }
    }
  }
  return added
}

// ── Behavioral classification of discovered services ─────────────────────────
// Gamblers play at several casinos, so a service whose counterparty set
// overlaps a KNOWN casino's far above the exchange baseline (~7% vs Stake) is
// gambling infrastructure with high confidence. We mark such services as
// casino-pattern — category becomes 'casino', the label stays clearly
// unattributed until a real nametag arrives (wayback/labels harvests).
const CLASSIFY_MIN_CPS = 200 // service must have this many counterparties
const CLASSIFY_REF_MIN_CPS = 10_000 // reference casino must be this mature
const CLASSIFY_MIN_OVERLAP = 0.15 // ≥15% shared users ≈ 2× exchange baseline

export function classifyServices(): number {
  const refs = db
    .prepare("SELECT id, label FROM watchlist WHERE active=1 AND category='casino' AND label NOT LIKE '%casino-pattern%'")
    .all() as { id: number; label: string }[]
  const refSets: { label: string; set: Set<string> }[] = []
  for (const r of refs) {
    const cps = (db.prepare('SELECT DISTINCT counterparty c FROM transfers WHERE watch_id=?').all(r.id) as any[]).map((x) => x.c)
    if (cps.length >= CLASSIFY_REF_MIN_CPS) refSets.push({ label: r.label, set: new Set(cps) })
  }
  if (refSets.length === 0) return 0

  const services = db
    .prepare("SELECT id, label, chain FROM watchlist WHERE active=1 AND label LIKE 'Service %'")
    .all() as { id: number; label: string; chain: string }[]
  let flagged = 0
  for (const s of services) {
    const cps = (db.prepare('SELECT DISTINCT counterparty c FROM transfers WHERE watch_id=?').all(s.id) as any[]).map((x) => x.c)
    if (cps.length < CLASSIFY_MIN_CPS) continue
    for (const ref of refSets) {
      let shared = 0
      for (const c of cps) if (ref.set.has(c)) shared++
      const overlap = shared / cps.length
      if (overlap >= CLASSIFY_MIN_OVERLAP) {
        const newLabel = s.label.replace(/^Service /, 'Casino-pattern ').slice(0, 48)
        db.prepare('UPDATE watchlist SET label=?, category=? WHERE id=?').run(newLabel, 'casino', s.id)
        db.prepare('UPDATE transfers SET label=?, category=? WHERE watch_id=?').run(newLabel, 'casino', s.id)
        flagged++
        console.log(
          `[labels] ${s.chain} ${s.label} → casino-pattern (${(overlap * 100).toFixed(1)}% user overlap with ${ref.label}, n=${cps.length})`,
        )
        break
      }
    }
  }
  return flagged
}

export async function runLabelHarvest(force = false) {
  const last = Number(stateGet('labels:lastRun') ?? 0)
  if (!force && Date.now() - last < REFRESH_DAYS * 86_400_000) return
  console.log('[labels] harvesting public casino-wallet attributions…')
  let eth = 0
  let tron = 0
  try {
    eth = await harvestEthGambling()
  } catch (e) {
    console.warn('[labels] eth harvest failed:', (e as Error).message)
  }
  try {
    tron = await harvestTronTags()
  } catch (e) {
    console.warn('[labels] tron harvest failed:', (e as Error).message)
  }
  let services = 0
  try {
    services = discoverServices()
  } catch (e) {
    console.warn('[labels] service discovery failed:', (e as Error).message)
  }
  stateSet('labels:lastRun', Date.now())
  console.log(`[labels] done — +${eth} ETH casino wallets, +${tron} TRON tagged wallets, +${services} discovered services`)
}

export function startLabels() {
  // boot harvest (non-blocking) + weekly refresh
  runLabelHarvest().catch(() => {})
  setInterval(() => runLabelHarvest().catch(() => {}), 12 * 3600_000)
  // graph-based service discovery is cheap — refresh daily regardless of the
  // explorer-label cadence (delayed past boot so the indexers warm up first)
  setTimeout(() => {
    try {
      discoverServices()
    } catch {}
  }, 60_000)
  setInterval(() => {
    try {
      discoverServices()
      classifyServices()
    } catch {}
  }, 24 * 3600_000)
  // classification needs accumulated history — run once after the indexers
  // have had a while to build the new services' profiles
  setTimeout(() => {
    try {
      classifyServices()
    } catch {}
  }, 45 * 60_000)
}
