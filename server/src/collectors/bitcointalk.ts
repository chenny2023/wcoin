import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { brandName } from '../casinometa.ts'
import { score } from '../sentiment.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Bitcointalk gambling-forum mentions. Bitcointalk's Gambling board (56) and
// Gambling discussion board (228) are where crypto-casino operators run their
// official threads and where players post reviews/complaints — the oldest, most
// concentrated crypto-gambling community. It's a plain phpBB-style forum (no
// bot/TLS fingerprinting like Reddit), so our HTTP client reaches it directly.
// We scan the board listings, match topic titles to watched casino brands, and
// feed the same `mentions` table the Sentiment page reads (source='bitcointalk').
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// board pages to sweep (one per cycle, round-robin): Gambling (56) + Gambling
// discussion (228), a few pages deep (40 topics/page)
const PAGES: string[] = [
  ...[0, 40, 80, 120].map((s) => `https://bitcointalk.org/index.php?board=56.${s}`),
  ...[0, 40].map((s) => `https://bitcointalk.org/index.php?board=228.${s}`),
]

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'bitcointalk', @title, @url, 0, @sentiment, @ts)
`)

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/[^\x20-\x7e]+/g, ' ') // strip the ASCII-art borders common in BT thread titles
    .replace(/\s+/g, ' ')
    .trim()
}
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function brandMatchers(): { label: string; re: RegExp }[] {
  const labels = db.prepare("SELECT DISTINCT label FROM watchlist WHERE category='casino' AND active=1").all() as { label: string }[]
  const seen = new Set<string>()
  const out: { label: string; re: RegExp }[] = []
  for (const { label } of labels) {
    const brand = brandName(label)
    const key = brand.toLowerCase()
    if (seen.has(key) || brand.length < 4) continue // ≥4 chars to avoid short-name false hits
    seen.add(key)
    const esc = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out.push({ label: brand, re: new RegExp(`\\b${esc}\\b`, 'i') })
  }
  return out
}

let cursor = 0

export async function runBitcointalkOnce() {
  const matchers = brandMatchers()
  if (matchers.length === 0) return
  const pageUrl = PAGES[cursor % PAGES.length]
  cursor++

  let html: string
  try {
    const res = await webFetch(pageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
  } catch (e) {
    console.warn('[bitcointalk] fetch failed:', (e as Error).message)
    return
  }

  // topic subject links: <a href="...index.php?topic=NUMBER.0...">TITLE</a>
  let added = 0
  const now = Date.now()
  const tx = db.transaction(() => {
    for (const m of html.matchAll(/index\.php\?topic=(\d+)\.0[^"']*["'][^>]*>([^<]{4,200})<\/a>/g)) {
      const topicId = m[1]
      const title = decode(m[2])
      if (title.length < 4) continue
      for (const br of matchers) {
        if (!br.re.test(title)) continue
        added += insertMention.run({
          id: `bt_${topicId}_${br.label.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          watch_label: br.label,
          title: title.slice(0, 300),
          url: `https://bitcointalk.org/index.php?topic=${topicId}.0`,
          sentiment: score(title),
          ts: now,
        }).changes
      }
    }
  })
  tx()
  if (added) console.log(`[bitcointalk] +${added} forum mentions (${pageUrl.split('board=')[1]})`)
}

export function startBitcointalk() {
  console.log('[bitcointalk] gambling-forum mention feed active')
  const loop = async () => {
    await runBitcointalkOnce().catch((e) => console.warn('[bitcointalk]', (e as Error).message))
    setTimeout(loop, 90_000) // one board page per 90s — gentle on the forum
  }
  setTimeout(loop, 60_000)
}
