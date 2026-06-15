import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db } from '../db.ts'
import { arkhamFetch } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Arkham Intelligence collector. Maps each roster casino → its Arkham "gambling"
// entity (search by name), then pulls all-chain reserves from the entity's
// portfolio. This expands on-chain coverage far beyond the chains/tokens we index
// ourselves — Arkham attributes Tron, Bitcoin, every EVM chain, etc. Paced for the
// API's rate limit. Volume (windowed transfer USD) lands in a later phase.
// ─────────────────────────────────────────────────────────────────────────────

// Mainstream tokens only (the user's rule: ignore shitcoins/casino tokens). Match
// by ticker; bridged/peg stables (binance-bridged-usdc…) all carry a usdc/usdt sym.
const MAIN_SYMBOLS = new Set([
  'usdt', 'usdc', 'usdc.e', 'dai', 'busd', 'tusd', 'usdp', 'pyusd', 'fdusd', 'bsc-usd', 'usds', 'usde',
  'eth', 'weth', 'beth', 'steth', 'wsteth', 'btc', 'btcb', 'wbtc', 'cbbtc', 'tbtc',
  'bnb', 'wbnb', 'trx', 'sol', 'xrp', 'ltc', 'doge', 'bch', 'ada', 'avax', 'matic', 'pol', 'ton', 'dot',
])
function isMainstream(symbol: string): boolean {
  return MAIN_SYMBOLS.has((symbol || '').toLowerCase())
}

const upsertSeed = db.prepare('INSERT INTO arkham_casino(key, name) VALUES(@key, @name) ON CONFLICT(key) DO NOTHING')
const setResolved = db.prepare('UPDATE arkham_casino SET entity_id=@id, entity_type=@type, resolved_at=@now WHERE key=@key')
const setMetrics = db.prepare('UPDATE arkham_casino SET reserves_usd=@reserves, updated_at=@now WHERE key=@key')

function seedFromRoster() {
  try {
    const path = fileURLToPath(new URL('../data/casino-roster.json', import.meta.url))
    const roster = JSON.parse(readFileSync(path, 'utf8')) as any[]
    let n = 0
    const tx = db.transaction(() => {
      for (const c of roster) {
        const name = String(c.name ?? '').trim()
        const key = String(c.slug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        if (name && key) n += upsertSeed.run({ key, name }).changes
      }
    })
    tx()
    if (n) console.log(`[arkham] seeded ${n} casinos from roster`)
  } catch (e) {
    console.warn('[arkham] roster seed failed:', (e as Error).message)
  }
}

// search Arkham for a casino name → first entity tagged "gambling"
async function resolveOne(): Promise<boolean> {
  const row = db.prepare('SELECT key, name FROM arkham_casino WHERE resolved_at=0 ORDER BY key LIMIT 1').get() as
    | { key: string; name: string }
    | undefined
  if (!row) return false
  const now = Date.now()
  try {
    const res = arkhamFetch(`/intelligence/search?query=${encodeURIComponent(row.name)}`, { signal: AbortSignal.timeout(25_000) })
    if (!res) return false
    const r = await res
    if (r.status === 200) {
      const j = (await r.json()) as { arkhamEntities?: { id: string; name: string; type: string }[] }
      const ent = (j.arkhamEntities ?? []).find((e) => e.type === 'gambling')
      setResolved.run({ key: row.key, id: ent?.id ?? '', type: ent?.type ?? '', now })
      if (ent) console.log(`[arkham] ${row.name} → entity ${ent.id}`)
    } else {
      // transient — leave unresolved for a later tick (don't mark)
      console.warn(`[arkham] search ${row.name}: HTTP ${r.status}`)
    }
  } catch (e) {
    console.warn(`[arkham] search ${row.name}: ${(e as Error).message.slice(0, 40)}`)
  }
  return true
}

function sumReserves(portfolio: Record<string, Record<string, any>>): number {
  let total = 0
  for (const chain in portfolio) {
    const toks = portfolio[chain]
    if (!toks || typeof toks !== 'object') continue
    for (const id in toks) {
      const t = toks[id]
      if (t && isMainstream(t.symbol) && typeof t.usd === 'number' && Number.isFinite(t.usd)) total += t.usd
    }
  }
  return total
}

const REFRESH_MS = 6 * 3600_000 // refresh reserves every ~6h

// pull all-chain portfolio for a resolved entity → mainstream reserves USD
async function refreshOne(): Promise<boolean> {
  const row = db
    .prepare("SELECT key, name, entity_id FROM arkham_casino WHERE entity_id IS NOT NULL AND entity_id != '' AND updated_at < @stale ORDER BY updated_at LIMIT 1")
    .get({ stale: Date.now() - REFRESH_MS }) as { key: string; name: string; entity_id: string } | undefined
  if (!row) return false
  const now = Date.now()
  try {
    const res = arkhamFetch(`/portfolio/entity/${encodeURIComponent(row.entity_id)}?time=${now}`, { signal: AbortSignal.timeout(30_000) })
    if (!res) return false
    const r = await res
    if (r.status === 200) {
      const reserves = sumReserves((await r.json()) as any)
      setMetrics.run({ key: row.key, reserves, now })
      console.log(`[arkham] ${row.name}: reserves $${Math.round(reserves).toLocaleString()}`)
    } else {
      console.warn(`[arkham] portfolio ${row.name}: HTTP ${r.status}`)
      setMetrics.run({ key: row.key, reserves: null, now }) // advance so we don't loop on a bad entity
    }
  } catch (e) {
    console.warn(`[arkham] portfolio ${row.name}: ${(e as Error).message.slice(0, 40)}`)
  }
  return true
}

export function startArkham() {
  if ((process.env.ARKHAM_ENABLED ?? '1') === '0') return
  if (!(process.env.arkham || process.env.ARKHAM_API_KEY)) {
    console.log('[arkham] no API key — collector idle')
    return
  }
  console.log('[arkham] entity attribution collector active')
  seedFromRoster()
  const loop = async () => {
    // resolve everything first, then keep reserves fresh
    const did = (await resolveOne().catch(() => false)) || (await refreshOne().catch(() => false))
    setTimeout(loop, did ? 6_000 : 60_000) // gentle on the API; idle slowly when nothing to do
  }
  setTimeout(loop, 30_000)
}

export interface ArkhamMetric {
  reserves: number | null
}
// key (roster slug) → arkham metrics, for the aggregate/leaderboard merge
export function arkhamMetrics(): Map<string, ArkhamMetric> {
  const out = new Map<string, ArkhamMetric>()
  for (const r of db.prepare("SELECT key, reserves_usd FROM arkham_casino WHERE entity_id != ''").all() as any[]) {
    out.set(r.key, { reserves: r.reserves_usd })
  }
  return out
}
