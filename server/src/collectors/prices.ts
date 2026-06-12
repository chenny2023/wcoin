import { db } from '../db.ts'
import { webFetch } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Historical daily price series for assets we value at non-1:1 (currently SOL —
// every other chain we index settles in stablecoins valued 1:1). A transfer's
// USD value must use the price ON THE DAY it happened, not today's spot, or
// months-old native-SOL deposits get mis-valued. Source: Binance daily klines
// (keyless), CoinGecko fallback. The series is held in memory for synchronous
// per-transfer lookups during indexing.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const upsert = db.prepare('INSERT INTO prices(asset, day, usd) VALUES(?, ?, ?) ON CONFLICT(asset, day) DO UPDATE SET usd=excluded.usd')

const cache = new Map<string, Map<number, number>>() // asset → (day → usd)
const spot = new Map<string, number>() // asset → latest price

function loadCache(asset: string) {
  const m = new Map<number, number>()
  for (const r of db.prepare('SELECT day, usd FROM prices WHERE asset=?').all(asset) as { day: number; usd: number }[]) m.set(r.day, r.usd)
  cache.set(asset, m)
  if (m.size) spot.set(asset, [...m.entries()].sort((a, b) => b[0] - a[0])[0][1])
}

// historical USD price for `asset` at time `ts` (ms). Falls back to the nearest
// earlier day, then to spot — never throws, so indexing is never blocked.
export function priceForDay(asset: string, ts: number): number {
  const m = cache.get(asset)
  if (!m || m.size === 0) return spot.get(asset) ?? 0
  const day = Math.floor(ts / DAY_MS)
  if (m.has(day)) return m.get(day)!
  // nearest earlier day within a week, else spot
  for (let d = day; d > day - 7; d--) if (m.has(d)) return m.get(d)!
  return spot.get(asset) ?? 0
}

async function withRetry<T>(fn: () => Promise<T | null>, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const r = await fn()
    if (r) return r
    await new Promise((res) => setTimeout(res, 2500))
  }
  return null
}

async function fetchBinance(symbol: string): Promise<[number, number][] | null> {
  return withRetry(async () => {
    try {
      const r = await webFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) return null
      const rows = (await r.json()) as any[]
      return rows.map((k) => [Math.floor(k[0] / DAY_MS), Number(k[4])] as [number, number])
    } catch {
      return null
    }
  })
}

async function fetchCoingecko(id: string): Promise<[number, number][] | null> {
  return withRetry(async () => {
    try {
      const r = await webFetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=180&interval=daily`, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) return null
      const j = (await r.json()) as any
      return (j.prices ?? []).map((p: number[]) => [Math.floor(p[0] / DAY_MS), p[1]] as [number, number])
    } catch {
      return null
    }
  })
}

async function refresh(asset: string, binanceSym: string, geckoId: string) {
  const data = (await fetchBinance(binanceSym)) ?? (await fetchCoingecko(geckoId))
  if (!data || data.length === 0) {
    console.warn(`[prices] ${asset} history unavailable`)
    return
  }
  const tx = db.transaction(() => {
    for (const [day, usd] of data) if (usd > 0) upsert.run(asset, day, usd)
  })
  tx()
  loadCache(asset)
  console.log(`[prices] ${asset} daily history loaded — ${data.length} days, spot ~$${(spot.get(asset) ?? 0).toFixed(2)}`)
}

export function startPrices() {
  loadCache('SOL') // serve cached immediately
  const run = () => refresh('SOL', 'SOLUSDT', 'solana').catch((e) => console.warn('[prices]', (e as Error).message))
  run()
  setInterval(run, 6 * 3600_000) // refresh 4×/day
  // if the initial load found nothing (transient outage), retry every 2 min
  const retry = setInterval(() => {
    if ((cache.get('SOL')?.size ?? 0) > 0) { clearInterval(retry); return }
    run()
  }, 120_000)
}
