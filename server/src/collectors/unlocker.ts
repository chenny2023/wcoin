import { stateGet, stateSet } from '../db.ts'
import { webFetchUnlocked } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Auto-escalating paid-unlocker fetch for fingerprint-blocked sites (Trustpilot,
// Reddit) that 403 even via clean residential IPs. ScraperAPI charges by tier, so
// we try cheapest→priciest and REMEMBER the lowest tier that works per channel —
// after the first probe each call costs a single request at the locked tier.
// No `render` tier: our targets are SSR HTML (Trustpilot JSON-LD) or raw JSON
// (Reddit search.json), and render would both waste credits and wrap JSON in HTML.
// ─────────────────────────────────────────────────────────────────────────────

// '' = standard (1 credit), premium = residential pool (~10), ultra_premium =
// hardest-site auto-solver for Cloudflare etc. (~30).
const TIERS = ['', '&premium=true', '&ultra_premium=true']

type FetchInit = Parameters<typeof webFetchUnlocked>[1]

// Returns the unlocked Response (even if the final tier is still blocked, so the
// caller can record the status), or null ONLY when the unlocker isn't configured
// (then the caller falls back to its normal path).
export async function unlockedFetch(channel: string, url: string, init: FetchInit): Promise<Response | null> {
  const key = `scraper:tier:${channel}`
  const start = Math.min(Math.max(Number(stateGet(key) ?? '0') || 0, 0), TIERS.length - 1)
  let last: Response | null = null
  for (let tier = start; tier < TIERS.length; tier++) {
    const p = webFetchUnlocked(url, init, TIERS[tier])
    if (!p) return null // unconfigured
    try {
      last = await p
    } catch {
      continue // transient ScraperAPI error — try the next tier
    }
    if (last.status < 400) {
      stateSet(key, tier) // lock onto the working tier
      return last
    }
    if (tier < TIERS.length - 1) {
      try {
        await last.body?.cancel?.()
      } catch {
        /* ignore */
      }
    }
  }
  return last // all tiers blocked — return the last response for the caller to log
}

export function unlockerTier(channel: string): number {
  return Number(stateGet(`scraper:tier:${channel}`) ?? '0') || 0
}
