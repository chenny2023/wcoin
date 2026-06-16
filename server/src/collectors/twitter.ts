import { db } from '../db.ts'
import { webFetchUnlocked, webFetchProxied, webFetch } from '../net.ts'
import { brandName } from '../casinometa.ts'
import { score } from '../sentiment.ts'

// ─────────────────────────────────────────────────────────────────────────────
// X / Twitter signal — KEYLESS, no developer account. X has shut down keyless
// third-party SEARCH (guest tokens activate but the search endpoints 404, and the
// public /search page is login-walled), so we can't crawl arbitrary chatter the
// way we do Bluesky/Reddit. What IS still publicly readable without auth is the
// embeddable profile-timeline widget (syndication.twitter.com), which carries each
// account's recent posts WITH real engagement (likes/retweets). We pull the
// official X account of each major casino, score the text with the shared gambling
// lexicon, and feed the same `mentions` table the Sentiment page reads
// (source='twitter'). It is per-IP rate-limited, so we route through the rotating
// unlocker (falls back to residential) and pace slowly — one account per cycle.
// Honest by construction: if X blocks us the source simply stays at zero.
// ─────────────────────────────────────────────────────────────────────────────

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Curated official X handle per major casino brand, keyed by the normalized brand
// (lowercase, alphanumeric only). Only brands with a known-good handle are polled;
// anything else is skipped. A wrong/closed handle just 404s and is ignored.
const HANDLE: Record<string, string> = {
  stake: 'Stake',
  rollbit: 'rollbitcom',
  shuffle: 'shufflecom',
  bcgame: 'BCGame',
  roobet: 'roobet',
  gamdom: 'Gamdom',
  rainbet: 'Rainbetcom',
  duelbits: 'Duelbits',
  cloudbet: 'Cloudbet',
  bitcasino: 'Bitcasinoio',
  sportsbet: 'Sportsbetio',
  betfury: 'BetFury',
  metawin: 'MetaWinHQ',
  fortunejack: 'FortuneJack',
  jackbit: 'JackbitCasino',
  vave: 'VaveCasino',
  betplay: 'BetplayIo',
  mbit: 'mBitcasino',
}

function normBrand(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'twitter', @title, @url, @score, @sentiment, @ts)
`)

// watched casino brands that have a curated handle, busiest first (so the brands
// people actually care about refresh soonest)
function targets(): { label: string; handle: string }[] {
  const rows = db
    .prepare(
      `SELECT w.label, COUNT(t.id) AS tx
       FROM watchlist w LEFT JOIN transfers t ON t.watch_id = w.id
       WHERE w.active = 1 AND w.category = 'casino'
       GROUP BY w.label ORDER BY tx DESC`,
    )
    .all() as { label: string; tx: number }[]
  const seen = new Set<string>()
  const out: { label: string; handle: string }[] = []
  for (const r of rows) {
    const key = normBrand(brandName(r.label))
    const handle = HANDLE[key]
    if (!handle || seen.has(key)) continue
    seen.add(key)
    out.push({ label: r.label, handle })
  }
  return out
}

// Fetch the public profile-timeline widget. Prefer the rotating unlocker (defeats
// the per-IP 429 X applies to the syndication host); fall back to residential, then
// a direct proxied fetch — whichever first returns usable HTML.
async function fetchTimeline(handle: string): Promise<string | null> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?showReplies=false`
  const headers = { 'User-Agent': UA, Accept: 'text/html' }
  const attempts: (Promise<Response> | null)[] = [
    webFetchUnlocked(url, { headers, signal: AbortSignal.timeout(40_000) }),
    webFetchProxied(url, { headers, signal: AbortSignal.timeout(20_000) }),
    webFetch(url, { headers, signal: AbortSignal.timeout(20_000) }),
  ]
  for (const p of attempts) {
    if (!p) continue
    try {
      const r = await p
      if (r.status === 200) {
        const html = await r.text()
        if (html.includes('__NEXT_DATA__')) return html
      }
    } catch {
      /* try next transport */
    }
  }
  return null
}

// Pull tweets out of the widget's embedded __NEXT_DATA__ payload.
function parseTweets(html: string): { id: string; text: string; likes: number; rts: number; ts: number }[] {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/)
  if (!m) return []
  let entries: any[]
  try {
    entries = JSON.parse(m[1])?.props?.pageProps?.timeline?.entries ?? []
  } catch {
    return []
  }
  const out: { id: string; text: string; likes: number; rts: number; ts: number }[] = []
  for (const e of entries) {
    const tw = e?.content?.tweet
    if (!tw) continue
    const text: string = tw.full_text ?? tw.text ?? ''
    const id: string = String(tw.id_str ?? tw.id ?? '')
    if (!text || !id) continue
    out.push({
      id,
      text,
      likes: Number(tw.favorite_count ?? 0),
      rts: Number(tw.retweet_count ?? 0),
      ts: Date.parse(tw.created_at ?? '') || Date.now(),
    })
  }
  return out
}

let list: { label: string; handle: string }[] = []
let cursor = 0
export let twitterConsecutiveFails = 0

export async function runTwitterOnce() {
  if (cursor >= list.length) {
    list = targets()
    cursor = 0
    if (list.length === 0) return
  }
  const { label, handle } = list[cursor++]
  try {
    const html = await fetchTimeline(handle)
    if (!html) throw new Error('no readable timeline')
    const tweets = parseTweets(html)
    let added = 0
    const tx = db.transaction(() => {
      for (const t of tweets) {
        const r = insertMention.run({
          id: `tw_${t.id}`,
          watch_label: label,
          title: t.text.replace(/\s+/g, ' ').slice(0, 300),
          url: `https://x.com/${handle}/status/${t.id}`,
          score: t.likes + t.rts, // engagement weight
          sentiment: score(t.text),
          ts: t.ts,
        })
        added += r.changes
      }
    })
    tx()
    if (twitterConsecutiveFails > 0) console.log('[twitter] recovered — resuming normal cadence')
    twitterConsecutiveFails = 0
    if (added) console.log(`[twitter] @${handle}: +${added} posts`)
  } catch (e) {
    twitterConsecutiveFails++
    if (twitterConsecutiveFails <= 3) console.warn(`[twitter] @${handle} failed:`, (e as Error).message)
    else if (twitterConsecutiveFails === 4)
      console.warn('[twitter] persistent failures (X rate-limit/block) — backing off to 30m until a request succeeds')
  }
}

export function startTwitter() {
  if ((process.env.TWITTER_ENABLED ?? '1') === '0') return
  console.log('[twitter] official-account X timeline collector active')
  const loop = async () => {
    await runTwitterOnce()
    // slow, polite cadence (X rate-limits the syndication host hard); back off far
    // on a persistent block, recover instantly on the next success.
    const delay = twitterConsecutiveFails >= 4 ? 30 * 60_000 : 90_000
    setTimeout(loop, delay)
  }
  setTimeout(loop, 60_000)
}
