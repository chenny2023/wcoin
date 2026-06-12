import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { brandKey, brandName } from '../casinometa.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Third-party trust signal — casino.guru "Safety Index" (0–10) per casino.
//
// Trustpilot and AskGamblers sit behind Cloudflare and 403 keyless clients, but
// casino.guru serves a public review page per casino with a JSON-LD Review
// block carrying the expert Safety Index. We scrape that one authoritative
// number per watched casino brand and store it — an independent reputation
// signal to blend alongside our on-chain trust + community votes (this is the
// external-review credibility layer; circus carries an equivalent wagerx_score).
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const REFRESH_DAYS = 3

const upsert = db.prepare(`
  INSERT INTO reviews(brand_key, source, score, score_max, url, updated_at)
  VALUES(@brand_key, 'casino.guru', @score, 10, @url, @updated_at)
  ON CONFLICT(brand_key, source) DO UPDATE SET score=excluded.score, url=excluded.url, updated_at=excluded.updated_at
`)

// brand name → candidate casino.guru slugs ("BC.Game" → bc-game / bcgame)
function slugCandidates(name: string): string[] {
  const base = name.toLowerCase().trim()
  const hyphen = base.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const plain = base.replace(/[^a-z0-9]+/g, '')
  return [...new Set([hyphen, plain])].filter(Boolean)
}

async function fetchSafetyIndex(slug: string): Promise<number | null> {
  try {
    const res = await webFetch(`https://casino.guru/${slug}-casino-review`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(18_000),
    })
    if (res.status !== 200) return null
    const t = await res.text()
    for (const m of t.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const j = JSON.parse(m[1])
        if (j['@type'] === 'Review' && j.reviewRating?.ratingValue) return Number(j.reviewRating.ratingValue)
      } catch {
        /* skip */
      }
    }
    const fb = t.match(/"@type"\s*:\s*"Review"[\s\S]{0,400}?"ratingValue"\s*:\s*"?([\d.]+)/)
    return fb ? Number(fb[1]) : null
  } catch {
    return null
  }
}

let queue: { key: string; name: string }[] = []
let cursor = 0
function refillQueue() {
  // prioritise casinos that actually have indexed flow (real, current brands)
  // over the legacy dead-dApp labels, so the valuable Safety Indexes land first
  const labels = db
    .prepare(
      `SELECT w.label, COALESCE(SUM(t.usd), 0) vol
       FROM watchlist w LEFT JOIN transfers t ON t.watch_id = w.id
       WHERE w.category='casino' AND w.active=1
       GROUP BY w.label ORDER BY vol DESC`,
    )
    .all() as { label: string; vol: number }[]
  const seen = new Set<string>()
  queue = []
  for (const { label } of labels) {
    const key = brandKey(label)
    if (seen.has(key)) continue
    seen.add(key)
    queue.push({ key, name: brandName(label) })
  }
  cursor = 0
}

export async function runReviewsOnce() {
  if (cursor >= queue.length) refillQueue()
  if (queue.length === 0) return
  const { key, name } = queue[cursor++]
  // skip if refreshed recently
  const row = db.prepare('SELECT updated_at FROM reviews WHERE brand_key=? AND source=?').get(key, 'casino.guru') as any
  if (row && Date.now() - row.updated_at < REFRESH_DAYS * 86_400_000) return

  for (const slug of slugCandidates(name)) {
    const score = await fetchSafetyIndex(slug)
    if (score != null && score > 0) {
      upsert.run({ brand_key: key, score, url: `https://casino.guru/${slug}-casino-review`, updated_at: Date.now() })
      console.log(`[reviews] ${name}: casino.guru Safety Index ${score}/10`)
      return
    }
    await new Promise((r) => setTimeout(r, 600))
  }
  // remember the miss so we don't hammer it every sweep
  upsert.run({ brand_key: key, score: 0, url: null, updated_at: Date.now() })
}

// brand_key → safety index, for aggregation (built fresh each call, tiny table)
export function reviewScores(): Map<string, { score: number; max: number; url: string | null }> {
  const rows = db.prepare("SELECT brand_key, score, score_max, url FROM reviews WHERE source='casino.guru' AND score>0").all() as any[]
  return new Map(rows.map((r) => [r.brand_key, { score: r.score, max: r.score_max, url: r.url }]))
}

export function startReviews() {
  console.log('[reviews] casino.guru Safety Index collector active')
  const loop = async () => {
    await runReviewsOnce().catch((e) => console.warn('[reviews]', (e as Error).message))
    setTimeout(loop, 12_000) // one casino per 12s — gentle
  }
  setTimeout(loop, 40_000)
}
