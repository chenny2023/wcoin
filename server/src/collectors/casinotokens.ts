import { webFetch } from '../net.ts'
import { brandKey } from '../casinometa.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Casino-token market data via CoinGecko (keyless). Several crypto casinos issue
// their own token (Rollbit RLB, Shuffle SHFL, …); the token's price, market cap
// and 24h move are a real financial-confidence signal that pairs uniquely with
// our on-chain flow — a premium dimension for the token-issuing operators. Held
// in memory, refreshed a few times an hour (one batched call, well under the free
// rate limit). Casinos without a token simply have no token data (graceful).
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// brand → CoinGecko coin id (verified). Wrong/delisted ids are silently dropped.
// `buyback` flags tokens with a known buyback-and-burn / revenue-share programme —
// a real "the house shares its edge" signal that's unique to crypto casinos.
const TOKENS: { brand: string; cgId: string; buyback?: boolean }[] = [
  { brand: 'Rollbit', cgId: 'rollbit-coin', buyback: true }, // RLB buyback+burn from GGR
  { brand: 'Shuffle', cgId: 'shuffle-2', buyback: true },
  { brand: 'Yeet', cgId: 'yeet' },
  { brand: 'BetFury', cgId: 'bfg-token', buyback: true },
  { brand: 'Wink', cgId: 'wink' },
  { brand: 'FUNToken', cgId: 'funfair' },
  { brand: 'Wagerr', cgId: 'wagerr' },
  { brand: 'WINR', cgId: 'winr-protocol' },
  { brand: 'Decentral Games', cgId: 'decentral-games' },
]

export interface TokenInfo {
  symbol: string
  price: number
  marketCap: number
  change24h: number | null
  change7d: number | null
  fdv: number | null
  volume24h: number | null
  athChangePct: number | null // % below all-time high (negative)
  buyback: boolean // known buyback-and-burn / revenue-share token
}

let tokens = new Map<string, TokenInfo>() // brandKey → token market data
export function tokenData(): Map<string, TokenInfo> {
  return tokens
}

async function refresh() {
  const ids = TOKENS.map((t) => t.cgId).join(',')
  try {
    const res = await webFetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h,7d`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) {
      console.warn(`[tokens] CoinGecko HTTP ${res.status} — keeping current token data`)
      return
    }
    const data = (await res.json()) as any[]
    if (!Array.isArray(data) || data.length === 0) return
    const byId = new Map(data.map((c) => [c.id, c]))
    const next = new Map<string, TokenInfo>()
    for (const t of TOKENS) {
      const c = byId.get(t.cgId)
      if (!c || !(c.current_price > 0)) continue
      next.set(brandKey(t.brand), {
        symbol: String(c.symbol ?? '').toUpperCase(),
        price: Number(c.current_price),
        marketCap: Number(c.market_cap ?? 0),
        change24h: c.price_change_percentage_24h != null ? Number(c.price_change_percentage_24h) : null,
        change7d: c.price_change_percentage_7d_in_currency != null ? Number(c.price_change_percentage_7d_in_currency) : null,
        fdv: c.fully_diluted_valuation != null ? Number(c.fully_diluted_valuation) : null,
        volume24h: c.total_volume != null ? Number(c.total_volume) : null,
        athChangePct: c.ath_change_percentage != null ? Number(c.ath_change_percentage) : null,
        buyback: !!t.buyback,
      })
    }
    if (next.size) {
      tokens = next
      console.log(`[tokens] casino-token market data refreshed — ${next.size} tokens`)
    }
  } catch (e) {
    console.warn('[tokens] CoinGecko refresh failed:', (e as Error).message)
  }
}

export function startCasinoTokens() {
  console.log('[tokens] casino-token market-data feed active (CoinGecko, keyless)')
  // self-healing cadence: the first fetch can time out under the boot-time backfill
  // load, so retry soon until we have data, then settle to a gentle 10-min refresh.
  const tick = async () => {
    await refresh()
    setTimeout(tick, tokens.size > 0 ? 10 * 60_000 : 90_000)
  }
  tick()
}
