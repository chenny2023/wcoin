import { db } from '../db.ts'
import { score } from '../sentiment.ts'
import { brandName } from '../casinometa.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Apple App Store user reviews (keyless). The iTunes RSS exposes recent customer
// reviews — real first-person sentiment with a star rating — for any app id, and
// the search API maps a name to its app. Most crypto casinos have NO App Store
// app (Apple restricts crypto gambling), so we STRICT-match: the app's name must
// actually contain the brand AND a casino keyword, or we skip it — otherwise a
// search for "Roobet" wrongly returns "Stake US". Where a real app exists (e.g.
// Stake US, ~16k reviews) we ingest its reviews into the same `mentions` table
// the Sentiment page reads (source='appstore'). Reachable directly, no proxy.
// ─────────────────────────────────────────────────────────────────────────────

import { webFetch } from '../net.ts'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const KW = /casino|slots?|bet|gambl|poker|crypto|game/i

const insertMention = db.prepare(`
  INSERT OR IGNORE INTO mentions(id, watch_label, source, title, url, score, sentiment, ts)
  VALUES(@id, @watch_label, 'appstore', @title, @url, @score, @sentiment, @ts)
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

// resolved app ids are stable — cache so we don't re-search every sweep
const appId = new Map<string, number | null>() // brandKey → app id (null = searched, none)

async function findApp(brand: string): Promise<number | null> {
  if (appId.has(brand)) return appId.get(brand)!
  const needle = brand.toLowerCase().replace(/\.(com|io|gg|game)$/, '')
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  let id: number | null = null
  try {
    const res = await webFetch(`https://itunes.apple.com/search?term=${encodeURIComponent(needle)}&entity=software&country=us&limit=5`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const j = (await res.json()) as { results?: any[] }
      for (const a of j.results ?? []) {
        const name: string = a.trackName ?? ''
        // STRICT: the app name must name the brand AND look like a casino app
        if (re.test(name) && KW.test(name) && (a.userRatingCount ?? 0) > 0) {
          id = Number(a.trackId)
          break
        }
      }
    }
  } catch {
    /* leave unresolved → retry next sweep */
    return null
  }
  appId.set(brand, id)
  return id
}

let list: { label: string; brand: string }[] = []
let cursor = 0

export async function runAppStoreOnce() {
  if (cursor >= list.length) {
    list = targets()
    cursor = 0
    if (list.length === 0) return
  }
  const { label, brand } = list[cursor++]
  const id = await findApp(brand)
  if (!id) return // no real App Store app for this casino
  try {
    const res = await webFetch(`https://itunes.apple.com/us/rss/customerreviews/id=${id}/sortBy=mostRecent/json`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = (await res.json()) as any
    const entries: any[] = j?.feed?.entry ?? []
    let added = 0
    const tx = db.transaction(() => {
      for (const e of entries) {
        const rid = e?.id?.label
        const rating = Number(e?.['im:rating']?.label ?? 0)
        if (!rid || !rating) continue // the first entry is app metadata (no rating)
        const title = (e?.title?.label ?? '').slice(0, 200)
        const body = (e?.content?.label ?? '').replace(/\s+/g, ' ')
        // blend the star rating into sentiment: lexicon + (rating-3)/2 nudges it
        const sent = Math.max(-1, Math.min(1, score(`${title} ${body}`) * 0.6 + ((rating - 3) / 2) * 0.4))
        added += insertMention.run({
          id: `as_${id}_${rid}`,
          watch_label: brand,
          title: (title + ' — ' + body).slice(0, 300),
          url: `https://apps.apple.com/us/app/id${id}`,
          score: rating,
          sentiment: sent,
          ts: Date.parse(e?.updated?.label ?? '') || Date.now(),
        }).changes
      }
    })
    tx()
    if (added) console.log(`[appstore] ${brand} (app ${id}): +${added} reviews`)
  } catch (e) {
    console.warn(`[appstore] ${brand} failed:`, (e as Error).message)
  }
}

export function startAppStore() {
  console.log('[appstore] Apple App Store reviews feed active (keyless)')
  const loop = async () => {
    await runAppStoreOnce().catch((e) => console.warn('[appstore]', (e as Error).message))
    setTimeout(loop, 25_000) // one casino per 25s
  }
  setTimeout(loop, 50_000)
}
