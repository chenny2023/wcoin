import { db } from '../db.ts'
import { webFetch } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// DefiLlama collector — the on-chain iGaming landscape beyond comprehensive
// casinos: prediction markets (Polymarket, Azuro, Overtime, Augur…), yield
// lotteries (PoolTogether…) and on-chain books. One keyless API call gives the
// whole category with live TVL, 1d/7d change, mcap and chains. Refreshed hourly.
// ─────────────────────────────────────────────────────────────────────────────

// DefiLlama categories that are iGaming/betting (no "Gambling" cat exists there;
// on-chain casinos are covered via Arkham instead).
const WANT = /prediction market|yield lottery|gambling|lottery|betting|sportsbook/i

const upsert = db.prepare(`
  INSERT INTO onchain_protocol(slug, name, category, chains, tvl, change_1d, change_7d, mcap, url, twitter, logo, updated_at)
  VALUES(@slug, @name, @category, @chains, @tvl, @change_1d, @change_7d, @mcap, @url, @twitter, @logo, @now)
  ON CONFLICT(slug) DO UPDATE SET
    name=excluded.name, category=excluded.category, chains=excluded.chains, tvl=excluded.tvl,
    change_1d=excluded.change_1d, change_7d=excluded.change_7d, mcap=excluded.mcap,
    url=excluded.url, twitter=excluded.twitter, logo=excluded.logo, updated_at=excluded.updated_at
`)

export async function runDefiLlamaOnce(): Promise<void> {
  try {
    const res = await webFetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(40_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const all = (await res.json()) as any[]
    const now = Date.now()
    let n = 0
    const tx = db.transaction(() => {
      for (const p of all) {
        if (!WANT.test(String(p.category ?? ''))) continue
        const slug = String(p.slug || p.name || '').toLowerCase()
        if (!slug) continue
        upsert.run({
          slug,
          name: String(p.name ?? slug),
          category: p.category ?? null,
          chains: Array.isArray(p.chains) ? p.chains.join(',') : null,
          tvl: typeof p.tvl === 'number' ? p.tvl : null,
          change_1d: typeof p.change_1d === 'number' ? p.change_1d : null,
          change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
          mcap: typeof p.mcap === 'number' ? p.mcap : null,
          url: p.url ?? null,
          twitter: p.twitter ?? null,
          logo: p.logo ?? null,
          now,
        })
        n++
      }
    })
    tx()
    console.log(`[defillama] refreshed ${n} on-chain iGaming protocols`)
  } catch (e) {
    console.warn('[defillama] failed:', (e as Error).message)
  }
}

export function startDefiLlama() {
  if ((process.env.DEFILLAMA_ENABLED ?? '1') === '0') return
  console.log('[defillama] on-chain iGaming protocol collector active')
  const loop = async () => {
    await runDefiLlamaOnce()
    setTimeout(loop, 3600_000) // hourly
  }
  setTimeout(loop, 20_000)
}
