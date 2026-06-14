import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { brandName } from '../casinometa.ts'
import { score } from '../sentiment.ts'

// ─────────────────────────────────────────────────────────────────────────────
// GDELT 2.0 DOC API — a keyless global news index spanning tens of thousands of
// outlets in many languages, far broader than Google News. For each watched
// casino brand we pull the last week's articles that name it, score the headline
// with the shared gambling lexicon, and feed the same `mentions` table the
// Sentiment page reads (source='gdelt'). Public research API, no IP-blocking.
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'gdelt', @title, @url, 0, @sentiment, @ts)
`)

function targets(): { label: string; brand: string }[] {
  const rows = db
    .prepare(
      `SELECT w.label, COUNT(t.id) AS tx
       FROM watchlist w LEFT JOIN transfers t ON t.watch_id = w.id
       WHERE w.active = 1 AND w.category = 'casino'
       GROUP BY w.label ORDER BY tx DESC`,
    )
    .all() as { label: string; tx: number }[]
  const seen = new Set<string>()
  const out: { label: string; brand: string }[] = []
  for (const r of rows) {
    const brand = brandName(r.label)
    const key = brand.toLowerCase()
    if (brand.length < 4 || seen.has(key)) continue // ≥4 chars: GDELT phrase search needs specificity
    seen.add(key)
    out.push({ label: r.label, brand })
  }
  return out
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// GDELT seendate is "YYYYMMDDTHHMMSSZ" — turn it into a real timestamp
function parseSeen(d: string): number {
  const m = d?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (!m) return Date.now()
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) || Date.now()
}

let list: { label: string; brand: string }[] = []
let cursor = 0
// GDELT throttles aggressively (429); when we trip it, back the loop right off
// and ease back in. A success clears it.
export let gdeltThrottled = false

export async function runGdeltOnce() {
  if (cursor >= list.length) {
    list = targets()
    cursor = 0
    if (list.length === 0) return
  }
  const { label, brand } = list[cursor++]
  try {
    // phrase-quote the brand and AND it with "casino" to cut false positives
    const needleBrand = brand.replace(/\.(com|io|gg|game)$/i, '')
    const q = encodeURIComponent(`"${needleBrand}" casino`)
    const res = await webFetch(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&maxrecords=25&sort=DateDesc&timespan=1w`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = (await res.json()) as { articles?: any[] }
    const arts = j.articles ?? []
    const re = new RegExp(`\\b${needleBrand.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    let added = 0
    const tx = db.transaction(() => {
      for (const a of arts) {
        const title: string = a?.title ?? ''
        const url: string = a?.url ?? ''
        if (!title || !url || !re.test(title)) continue // only keep headlines that actually name the brand
        const r = insertMention.run({
          id: `gd_${hash(url)}_${label}`,
          watch_label: label,
          title: title.replace(/\s+/g, ' ').slice(0, 300),
          url: url.slice(0, 400),
          sentiment: score(title),
          ts: parseSeen(a?.seendate ?? ''),
        })
        added += r.changes
      }
    })
    tx()
    gdeltThrottled = false
    if (added) console.log(`[gdelt] ${brand}: +${added} mentions`)
  } catch (e) {
    const msg = (e as Error).message
    if (/\b429\b/.test(msg)) {
      if (!gdeltThrottled) console.warn('[gdelt] rate-limited (429) — easing the polling interval')
      gdeltThrottled = true // back off the interval; this brand comes around again next sweep
    } else {
      gdeltThrottled = false
      console.warn(`[gdelt] ${brand} failed:`, msg)
    }
  }
}

export function startGdelt() {
  console.log('[gdelt] global news index (keyless) active')
  const loop = async () => {
    await runGdeltOnce()
    // GDELT free tier throttles hard; idle at 60s, and on a 429 back off to 3m
    setTimeout(loop, gdeltThrottled ? 180_000 : 60_000)
  }
  setTimeout(loop, 35_000)
}
