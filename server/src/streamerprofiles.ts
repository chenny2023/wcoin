import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db } from './db.ts'

// Curated streamer profiles (bio + social links) from a research export. Static —
// loaded once into memory and joined with live status from the streamers table on
// the detail endpoint. Streamers without a curated profile still get a detail view
// from their live stats alone (graceful).
export interface StreamerProfile {
  platform: string
  slug: string
  name: string
  followers: number
  content: string | null
  language: string | null
  bio: string | null
  telegram: string | null
  discord: string | null
  twitter: string | null
  instagram: string | null
  youtube: string | null
}

const profiles = new Map<string, StreamerProfile>()
try {
  const path = fileURLToPath(new URL('./data/streamer-profiles.json', import.meta.url))
  const arr = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as StreamerProfile[] // strip BOM
  for (const p of arr) profiles.set(`${p.platform.toLowerCase()}:${p.slug.toLowerCase()}`, p)
  console.log(`[profiles] loaded ${profiles.size} curated streamer profiles`)
} catch (e) {
  console.warn('[profiles] none loaded:', (e as Error).message)
}

// Fallback profile built from the live `streamers` row — bio, socials, verified
// status and account age fetched keyless from each platform's own public API. This
// means every polled streamer gets a basic profile, not just the hand-curated few.
function profileFromDb(platform: string, slug: string): StreamerProfile | null {
  try {
    const r = db
      .prepare('SELECT handle, platform, followers, bio, socials, game FROM streamers WHERE id=?')
      .get(`${platform.toLowerCase()}:${slug.toLowerCase()}`) as
      | { handle: string; platform: string; followers: number; bio: string | null; socials: string | null; game: string | null }
      | undefined
    if (!r) return null
    let soc: Record<string, string> = {}
    try {
      soc = r.socials ? JSON.parse(r.socials) : {}
    } catch {
      /* malformed → no socials */
    }
    return {
      platform: r.platform,
      slug,
      name: r.handle,
      followers: r.followers ?? 0,
      content: r.game ?? null,
      language: null,
      bio: r.bio ?? null,
      telegram: soc.telegram ?? null,
      discord: soc.discord ?? null,
      twitter: soc.twitter ?? soc.x ?? null,
      instagram: soc.instagram ?? null,
      youtube: soc.youtube ?? null,
    }
  } catch {
    return null
  }
}

export function getProfile(platform: string, slug: string): StreamerProfile | null {
  const curated = profiles.get(`${(platform || '').toLowerCase()}:${(slug || '').toLowerCase()}`) ?? null
  const dbp = profileFromDb(platform, slug)
  if (!curated) return dbp
  if (!dbp) return curated
  // curated (hand-verified) wins per-field; the DB fallback fills any gaps
  const merged = { ...dbp }
  for (const [k, v] of Object.entries(curated)) {
    if (v != null && v !== '') (merged as Record<string, unknown>)[k] = v
  }
  return merged
}
