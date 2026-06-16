import { db } from '../db.ts'
import { webFetch } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Polymarket collector — the prediction-market leader (~$450M TVL). Pulls the top
// active markets by traded volume from the public gamma-api (keyless): the live
// "what the world is betting on" feed with current odds. Refreshed every 10 min.
// ─────────────────────────────────────────────────────────────────────────────

const upsert = db.prepare(`
  INSERT INTO prediction_market(id, question, volume, liquidity, outcomes, prices, end_date, category, url, updated_at)
  VALUES(@id, @question, @volume, @liquidity, @outcomes, @prices, @end_date, @category, @url, @now)
  ON CONFLICT(id) DO UPDATE SET
    question=excluded.question, volume=excluded.volume, liquidity=excluded.liquidity,
    outcomes=excluded.outcomes, prices=excluded.prices, end_date=excluded.end_date,
    category=excluded.category, url=excluded.url, updated_at=excluded.updated_at
`)

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null)
const jstr = (v: any): string | null => {
  if (v == null) return null
  if (typeof v === 'string') return v // gamma already returns these as JSON strings
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
}

export async function runPolymarketOnce(): Promise<void> {
  try {
    const res = await webFetch('https://gamma-api.polymarket.com/markets?closed=false&order=volumeNum&ascending=false&limit=120', {
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const markets = (await res.json()) as any[]
    const now = Date.now()
    let n = 0
    const tx = db.transaction(() => {
      for (const m of markets) {
        const id = String(m.id ?? m.slug ?? m.conditionId ?? '')
        if (!id || !m.question) continue
        upsert.run({
          id,
          question: String(m.question).slice(0, 400),
          volume: num(m.volumeNum) ?? num(m.volume),
          liquidity: num(m.liquidityNum) ?? num(m.liquidity),
          outcomes: jstr(m.outcomes),
          prices: jstr(m.outcomePrices),
          end_date: m.endDate ?? null,
          category: m.category ?? null,
          // a market's own slug resolves at /market/{slug} (200); /event/{marketSlug}
          // 404s because event slugs differ. Prefer the parent event's slug when
          // present (lands on the grouped market), else the direct /market/ URL.
          url: m.events?.[0]?.slug
            ? `https://polymarket.com/event/${m.events[0].slug}`
            : m.slug
              ? `https://polymarket.com/market/${m.slug}`
              : null,
          now,
        })
        n++
      }
      // prune markets we no longer see in the top set so the table stays current
      db.prepare('DELETE FROM prediction_market WHERE updated_at < ?').run(now - 3 * 3600_000)
    })
    tx()
    console.log(`[polymarket] refreshed ${n} top prediction markets`)
  } catch (e) {
    console.warn('[polymarket] failed:', (e as Error).message)
  }
}

export function startPolymarket() {
  if ((process.env.POLYMARKET_ENABLED ?? '1') === '0') return
  console.log('[polymarket] prediction-market collector active')
  const loop = async () => {
    await runPolymarketOnce()
    setTimeout(loop, 600_000) // every 10 min
  }
  setTimeout(loop, 25_000)
}
