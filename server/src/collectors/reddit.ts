import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { score as lexScore } from '../sentiment.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Reddit social mentions via the PUBLIC search endpoint (no OAuth).
//
// Reddit's OAuth token endpoint (api/v1/access_token) 403s datacenter AND proxy
// IPs hard — even clean residential ones — so the credentialed flow is a dead end
// from a server. The public search.json endpoint, fetched with a real browser
// User-Agent through the residential proxy (net.ts routes reddit.com via
// REDDIT_PROXY), is the path the common scrapers use and is far more permissive.
// No credentials needed. Results feed the same `mentions` table the Sentiment
// page reads (source='reddit'); nothing is fabricated.
// ─────────────────────────────────────────────────────────────────────────────

export const redditEnabled = () => true

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'reddit', @title, @url, @score, @sentiment, @ts)
`)

// circuit breaker: back off when Reddit persistently blocks us, recover on success
export let redditConsecutiveFails = 0
let rr = 0

export async function runRedditOnce() {
  const casinos = db
    .prepare("SELECT DISTINCT label FROM watchlist WHERE category='casino' AND active=1")
    .all() as { label: string }[]
  if (casinos.length === 0) return
  const target = casinos[rr % casinos.length].label
  rr++

  const q = encodeURIComponent(`"${target.replace(/\.(com|io|gg)$/i, '')}"`)
  // public, keyless search — retry a few times (each webFetch picks a fresh proxy)
  const urls = [
    `https://www.reddit.com/search.json?q=${q}&sort=new&t=month&limit=25&type=link`,
    `https://old.reddit.com/search.json?q=${q}&sort=new&t=month&limit=25&type=link`, // old reddit is often less guarded
  ]
  let json: any = null
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3 && !json; attempt++) {
    const url = urls[attempt % urls.length]
    try {
      const res = await webFetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) {
        json = await res.json()
        break
      }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastErr = e as Error
    }
    await new Promise((r) => setTimeout(r, 600))
  }

  if (!json) {
    redditConsecutiveFails++
    if (redditConsecutiveFails <= 3) console.warn(`[reddit] ${target} failed:`, lastErr?.message)
    else if (redditConsecutiveFails === 4) console.warn('[reddit] persistent failures — backing off to 30m until a request succeeds')
    return
  }
  if (redditConsecutiveFails > 0) console.log('[reddit] recovered — resuming normal cadence')
  redditConsecutiveFails = 0

  let added = 0
  const tx = db.transaction((children: any[]) => {
    for (const c of children) {
      const d = c?.data
      if (!d?.id) continue
      const text = `${d.title ?? ''} ${d.selftext ?? ''}`.slice(0, 4000)
      const r = insertMention.run({
        id: `rd_${d.id}_${target}`,
        watch_label: target,
        title: (d.title ?? '').slice(0, 300),
        url: 'https://reddit.com' + (d.permalink ?? ''),
        score: d.score ?? 0,
        sentiment: lexScore(text),
        ts: Math.round((d.created_utc ?? 0) * 1000),
      })
      added += r.changes
    }
  })
  tx(json?.data?.children ?? [])
  if (added) console.log(`[reddit] ${target}: +${added} mentions`)
}

export function startReddit() {
  console.log('[reddit] public search feed active (keyless, via residential proxy)')
  const loop = async () => {
    await runRedditOnce()
    // healthy: one casino per 20s. Blocked: back off to 30m; a single success flips back.
    const delay = redditConsecutiveFails >= 4 ? 30 * 60_000 : 20_000
    setTimeout(loop, delay)
  }
  setTimeout(loop, 40_000)
}
