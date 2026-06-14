import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { brandName } from '../casinometa.ts'
import { score } from '../sentiment.ts'

// ─────────────────────────────────────────────────────────────────────────────
// iGaming industry-press mentions. Pulls the public RSS feeds of the major
// trade publications and matches each article to watched casino brands by name.
// Far higher signal density than a generic web search — these outlets cover
// exactly the operators we track (regulation, funding, sponsorships, fines).
// Stored in the same `mentions` table the Sentiment page reads, source='press'.
// ─────────────────────────────────────────────────────────────────────────────

const FEEDS = [
  { name: 'SBC News', url: 'https://sbcnews.co.uk/feed/' },
  { name: 'iGaming Business', url: 'https://igamingbusiness.com/feed/' },
  { name: 'CasinoBeats', url: 'https://casinobeats.com/feed/' },
  { name: 'Gambling Insider', url: 'https://www.gamblinginsider.com/rss/news' },
  // broader iGaming + crypto-gambling trade press for more brand coverage
  { name: 'Casino.org News', url: 'https://www.casino.org/news/feed/' },
  { name: 'CalvinAyre', url: 'https://calvinayre.com/feed/' },
  { name: 'European Gaming', url: 'https://europeangaming.eu/portal/feed/' },
  { name: 'SiGMA', url: 'https://sigma.world/feed/' },
  { name: 'Gambling News', url: 'https://www.gamblingnews.com/feed/' },
  { name: 'Yogonet', url: 'https://www.yogonet.com/international/rss' },
]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'press', @title, @url, 0, @sentiment, @ts)
`)

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, "'").replace(/&#8217;/g, "'")
    .replace(/\s+/g, ' ').trim()
}
function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decode(m[1]) : ''
}
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// distinct casino brands → matcher (escape regex, word-boundary, ≥4 chars to
// avoid false hits on short names)
function brandMatchers(): { label: string; re: RegExp }[] {
  const labels = db.prepare("SELECT DISTINCT label FROM watchlist WHERE category='casino' AND active=1").all() as { label: string }[]
  const seen = new Set<string>()
  const out: { label: string; re: RegExp }[] = []
  for (const { label } of labels) {
    const brand = brandName(label)
    const key = brand.toLowerCase()
    if (seen.has(key) || brand.length < 4) continue
    seen.add(key)
    const esc = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out.push({ label: brand, re: new RegExp(`\\b${esc}\\b`, 'i') })
  }
  return out
}

export async function runPressOnce() {
  const matchers = brandMatchers()
  if (matchers.length === 0) return
  let added = 0
  for (const feed of FEEDS) {
    let xml: string
    try {
      const res = await webFetch(feed.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) continue
      xml = await res.text()
    } catch {
      continue
    }
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
    for (const item of items) {
      const title = tag(item, 'title')
      const desc = tag(item, 'description')
      const link = tag(item, 'link') || (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || ''
      const pub = Date.parse(tag(item, 'pubDate'))
      if (!title) continue
      const text = `${title} ${desc}`
      const sentiment = score(text)
      const ts = Number.isNaN(pub) ? Date.now() : pub
      for (const m of matchers) {
        if (!m.re.test(text)) continue
        const r = insertMention.run({
          id: `pr_${hash(link || title)}_${m.label}`,
          watch_label: m.label,
          title: title.slice(0, 300),
          url: link.slice(0, 400),
          sentiment,
          ts,
        })
        added += r.changes
      }
    }
  }
  if (added) console.log(`[press] +${added} industry-press mentions`)
}

export function startPress() {
  console.log('[press] iGaming trade-press mention feed active')
  const loop = async () => {
    await runPressOnce().catch((e) => console.warn('[press]', (e as Error).message))
    setTimeout(loop, 30 * 60_000) // every 30 min
  }
  setTimeout(loop, 50_000)
}
