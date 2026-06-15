import { db } from '../db.ts'

// Shared helpers for the streamer collectors (Kick / Twitch / YouTube). The roster
// is over-seeded generously across platforms — wrong/renamed handles 404 on first
// poll and deactivate themselves, so there's no harm in casting a wide net.

export function seedRoster(platform: string, slugs: string[]): void {
  const now = Date.now()
  const ins = db.prepare('INSERT OR IGNORE INTO streamer_roster(platform, slug, active, created_at) VALUES(?, ?, 1, ?)')
  let added = 0
  const tx = db.transaction(() => {
    for (const s of slugs) {
      const slug = s.trim()
      if (slug) added += ins.run(platform, slug, now).changes
    }
  })
  tx()
  if (added) console.log(`[${platform.toLowerCase()}] roster topped up with ${added} channels`)
}

const CASINO_BRANDS = [
  'stake', 'gamdom', 'roobet', 'rollbit', 'duelbits', 'shuffle', 'bc.game', 'bcgame',
  'metaspins', 'csgoempire', 'hypedrop', 'packdraw', '1xbet', 'bitsler', 'chips.gg',
  'rainbet', 'clash.gg', 'gamba', 'jackbit', 'sportsbet', 'betfury', 'wildcasino',
]

// derive a casino affiliation from a stream title / bio by matching watchlist
// labels (operator intelligence) first, then well-known brands. Word-boundary
// matched so "stake" doesn't false-match "mistake".
export function detectAffiliation(...texts: (string | null | undefined)[]): string | null {
  const hay = texts.filter(Boolean).join(' ').toLowerCase()
  if (!hay) return null
  const wb = (s: string) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)
  const labels = db.prepare("SELECT DISTINCT label FROM watchlist WHERE category='casino' AND active=1").all() as { label: string }[]
  for (const { label } of labels) {
    const key = label.toLowerCase().replace(/\.(com|io|gg|game)$/, '')
    if (key.length >= 4 && wb(key)) return label
  }
  for (const brand of CASINO_BRANDS) {
    if (wb(brand)) return brand.charAt(0).toUpperCase() + brand.slice(1)
  }
  return null
}
