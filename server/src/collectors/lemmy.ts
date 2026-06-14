import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { brandName } from '../casinometa.ts'
import { score } from '../sentiment.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Lemmy — the federated, open-source Reddit alternative. Reddit/Twitter/Bluesky
// all block our requests at the fingerprint layer, but Lemmy's public API is
// genuinely open (keyless, no bot wall), so it's the one user-generated social
// channel we can actually read. Coverage is thinner than Reddit, but it's real
// first-person discussion. We search the largest instance for each casino and
// feed the same `mentions` table the Sentiment page reads (source='lemmy').
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const INSTANCE = process.env.LEMMY_INSTANCE || 'https://lemmy.world'

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'lemmy', @title, @url, @score, @sentiment, @ts)
`)

function targets(): { label: string; brand: string }[] {
  const rows = db
    .prepare(
      `SELECT w.label, COUNT(t.id) AS tx FROM watchlist w LEFT JOIN transfers t ON t.watch_id=w.id
       WHERE w.active=1 AND w.category='casino' GROUP BY w.label ORDER BY tx DESC`,
    )
    .all() as { label: string; tx: number }[]
  const seen = new Set<string>()
  const out: { label: string; brand: string }[] = []
  for (const r of rows) {
    const brand = brandName(r.label)
    const k = brand.toLowerCase()
    if (brand.length < 4 || seen.has(k)) continue
    seen.add(k)
    out.push({ label: r.label, brand })
  }
  return out
}

let list: { label: string; brand: string }[] = []
let cursor = 0

export async function runLemmyOnce() {
  if (cursor >= list.length) {
    list = targets()
    cursor = 0
    if (list.length === 0) return
  }
  const { label, brand } = list[cursor++]
  const needle = brand.toLowerCase().replace(/\.(com|io|gg|game)$/, '')
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  try {
    const q = encodeURIComponent(brand.replace(/\.(com|io|gg|game)$/i, ''))
    const res = await webFetch(`${INSTANCE}/api/v3/search?q=${q}&type_=Posts&sort=New&limit=20`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = (await res.json()) as { posts?: any[] }
    let added = 0
    const tx = db.transaction(() => {
      for (const p of j.posts ?? []) {
        const post = p?.post
        if (!post?.id) continue
        const text = `${post.name ?? ''} ${post.body ?? ''}`
        if (!re.test(text)) continue // must actually name the brand (word boundary)
        added += insertMention.run({
          id: `lm_${post.id}_${label}`,
          watch_label: brand,
          title: (post.name ?? '').replace(/\s+/g, ' ').slice(0, 300),
          url: post.ap_id ?? `${INSTANCE}/post/${post.id}`,
          score: Number(p?.counts?.score ?? 0),
          sentiment: score(text),
          ts: Date.parse(post.published ?? '') || Date.now(),
        }).changes
      }
    })
    tx()
    if (added) console.log(`[lemmy] ${brand}: +${added} mentions`)
  } catch (e) {
    console.warn(`[lemmy] ${brand} failed:`, (e as Error).message)
  }
}

export function startLemmy() {
  console.log('[lemmy] federated-social mention feed active (keyless)')
  const loop = async () => {
    await runLemmyOnce().catch((e) => console.warn('[lemmy]', (e as Error).message))
    setTimeout(loop, 25_000) // one casino per 25s
  }
  setTimeout(loop, 45_000)
}
