import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { brandName } from '../casinometa.ts'
import { score } from '../sentiment.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Genuine user-generated social chatter via Bluesky's PUBLIC AppView search
// (app.bsky.feed.searchPosts) — keyless, and unlike Reddit it serves public read
// traffic without IP-blocking datacenter ranges. For each watched casino brand we
// pull recent posts that name it, score them with the shared gambling lexicon,
// and feed the same `mentions` table the Sentiment page reads (source='bluesky').
// If Bluesky ever rejects our requests it just fails that cycle (graceful) and
// the source stays at zero — nothing is fabricated.
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'bluesky', @title, @url, @score, @sentiment, @ts)
`)

// distinct casino brands (canonical name), casinos that actually have flow first
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
    if (brand.length < 3 || seen.has(key)) continue
    seen.add(key)
    out.push({ label: r.label, brand })
  }
  return out
}

let list: { label: string; brand: string }[] = []
let cursor = 0

export async function runBlueskyOnce() {
  if (cursor >= list.length) {
    list = targets()
    cursor = 0
    if (list.length === 0) return
  }
  const { label, brand } = list[cursor++]
  try {
    const q = encodeURIComponent(brand.replace(/\.(com|io|gg|game)$/i, '')) // "Stake.com" → search "Stake"
    const res = await webFetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${q}&limit=25&sort=latest`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = (await res.json()) as { posts?: any[] }
    const posts = j.posts ?? []
    // word-boundary brand match so "Stake" doesn't catch "mistake"
    const needle = brand.toLowerCase().replace(/\.(com|io|gg|game)$/i, '')
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    let added = 0
    const tx = db.transaction(() => {
      for (const p of posts) {
        const text: string = p?.record?.text ?? ''
        if (!text || !re.test(text)) continue
        const handle: string = p?.author?.handle ?? ''
        const rkey = String(p?.uri ?? '').split('/').pop() ?? ''
        if (!rkey) continue
        const ts = Date.parse(p?.record?.createdAt ?? p?.indexedAt ?? '') || Date.now()
        const r = insertMention.run({
          id: `bs_${rkey}_${label}`,
          watch_label: label,
          title: text.replace(/\s+/g, ' ').slice(0, 300),
          url: handle ? `https://bsky.app/profile/${handle}/post/${rkey}` : '',
          score: Number(p?.likeCount ?? 0),
          sentiment: score(text),
          ts,
        })
        added += r.changes
      }
    })
    tx()
    if (added) console.log(`[bluesky] ${brand}: +${added} mentions`)
  } catch (e) {
    console.warn(`[bluesky] ${brand} failed:`, (e as Error).message)
  }
}

export function startBluesky() {
  console.log('[bluesky] public post search active')
  const loop = async () => {
    await runBlueskyOnce()
    setTimeout(loop, 25_000) // one brand per 25s — polite to the public AppView
  }
  setTimeout(loop, 30_000)
}
