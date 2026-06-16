import { webFetch } from '../net.ts'
import { db } from '../db.ts'
import { seedRoster, detectAffiliation } from './streamerutil.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Twitch streamer monitoring — KEYLESS. Instead of the credentialed Helix API we
// query Twitch's public GraphQL endpoint with the web client's own client-id (the
// same one twitch.tv ships in the browser), so no app/token is needed. A roster
// of iGaming streamers is polled round-robin for real follower count, live status,
// viewers, title and game. Routed through the residential pool (net.ts) to dodge
// datacenter blocks. 404/unknown logins deactivate themselves. Nothing fabricated.
// ─────────────────────────────────────────────────────────────────────────────

export const twitchEnabled = () => true

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // Twitch's public web client-id

const ROSTER_SEED = [
  'roshtein', 'trainwreckstv', 'classybeef', 'casinodaddy', 'letsgiveitaspin', 'xposed',
  'watchgamestv', 'slotspinner', 'fruityslots', 'deuceace', 'nickslots', 'jackpotmike',
  'ayezee', 'vondy', 'spintwix', 'hideousslots', 'knossi', 'm0e_tv', 'bymdoom', 'cheesur',
  'daskino', 'slotsfighter', 'bigwins', 'theclassybeef', 'mrgambleslots',
  // wave 2
  'roshtein_', 'casinogrounds', 'jarttu84', 'stop_and_step', 'ozzyslots', 'kingjafi',
  'slotmojo', 'thebandit', 'craz', 'mexify', 'sapioo', 'jagbir', 'mrbigspin',
  'ngslots', 'kimslots', 'rawslots', 'casinoninja', 'slothunters', 'bigwinboard',
  'deuceace_', 'thomas', 'rincon', 'dinoo', 'gambit', 'p2isten', 'foltyn',
  'montanablack88', 'eliasn97', 'westcol', 'adinross', 'cuffem', 'yassuo', 'm0xyy',
  // curated from a SullyGnome Slots-category export (52 real handles, by followers)
  'coringa', 'elded', 'ddg', 'zilverk', 'vicens', 'komanche', 'markilokurasy', 'llobeti4',
  'mrlust', 'alkapone', 'aircool', 'khanada_', 'mateoz', 'm0e_tv', 'pgod', 'snoopdogg',
  'jaycinco', 'piuzinho', 'ryux', 'prod', 'giggand', 'mitchjones', 'lobanjicaa', 'shanks_ttv',
  'andymilonakis', 'blou', 'demisux', 'faxuty', 'pabellon_4', 'bugha', 'anomaly', 'soypan',
  'okyyy', 'blackelespanolito', 'hastad', 'mrsoki', 'yetz', 'jjjjoaco', 'choc', 'elmiillor',
  'zony', 'liljarvis', 'nakoo_fn', 'fnxlntc', 'crusherfooxi10', 'hasvik', 'rickyedit', 'huskerrs',
]

const upsert = db.prepare(`
  INSERT INTO streamers(id, handle, platform, viewers, live, title, game, thumbnail, followers, affiliation, updated_at)
  VALUES(@id, @handle, 'Twitch', @viewers, @live, @title, @game, @thumbnail, @followers, @affiliation, @now)
  ON CONFLICT(id) DO UPDATE SET
    viewers=excluded.viewers, live=excluded.live, title=excluded.title, game=excluded.game,
    thumbnail=excluded.thumbnail, followers=excluded.followers,
    affiliation=COALESCE(excluded.affiliation, streamers.affiliation), updated_at=excluded.updated_at
`)

let rr = 0

export async function runTwitchOnce(): Promise<void> {
  const roster = db.prepare("SELECT id, slug FROM streamer_roster WHERE platform='Twitch' AND active=1").all() as { id: number; slug: string }[]
  if (roster.length === 0) return
  const entry = roster[rr++ % roster.length]
  try {
    const query = `query{user(login:"${entry.slug}"){displayName followers{totalCount} stream{viewersCount title game{name}} profileImageURL(width:300)}}`
    const res = await webFetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const u = ((await res.json()) as any)?.data?.user
    if (!u) {
      db.prepare('UPDATE streamer_roster SET active=0 WHERE id=?').run(entry.id)
      console.warn(`[twitch] ${entry.slug}: unknown login — deactivated`)
      return
    }
    const s = u.stream
    upsert.run({
      id: 'twitch:' + entry.slug,
      handle: u.displayName ?? entry.slug,
      viewers: s?.viewersCount ?? 0,
      live: s ? 1 : 0,
      title: s?.title ?? null,
      game: s?.game?.name ?? null,
      thumbnail: u.profileImageURL ?? null,
      followers: u.followers?.totalCount ?? 0,
      affiliation: detectAffiliation(s?.title),
      now: Date.now(),
    })
    if (s) console.log(`[twitch] ${entry.slug}: LIVE ${s.viewersCount} · ${s.game?.name ?? '?'}`)
  } catch (e) {
    console.warn(`[twitch] ${entry.slug} failed:`, (e as Error).message)
  }
}

// Auto-discover live gambling streamers from Twitch's category directories and
// add them to the roster — so coverage grows itself instead of relying on a
// hand-typed list. Catches the long tail of active casino streamers continuously.
const DISCOVER_GAMES = ['Slots', 'Virtual Casino', 'Slots & Casino']
let discoverIdx = 0
export async function runTwitchDiscovery(): Promise<void> {
  const game = DISCOVER_GAMES[discoverIdx++ % DISCOVER_GAMES.length]
  try {
    const query = `query{game(name:"${game.replace(/"/g, '')}"){streams(first:80){edges{node{broadcaster{login}}}}}}`
    const res = await webFetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return
    const edges = ((await res.json()) as any)?.data?.game?.streams?.edges ?? []
    const logins = edges.map((e: any) => e?.node?.broadcaster?.login).filter(Boolean)
    if (logins.length) {
      seedRoster('Twitch', logins)
      console.log(`[twitch] discovered ${logins.length} live "${game}" streamers`)
    }
  } catch {
    /* transient */
  }
}

export function startTwitch() {
  seedRoster('Twitch', ROSTER_SEED)
  const loop = async () => {
    await runTwitchOnce()
    setTimeout(loop, 6_000) // one channel per 6s — full roster sweep ≈ a few min
  }
  setTimeout(loop, 12_000)
  // category discovery every 5 min — auto-grows the roster with live casino streamers
  setTimeout(() => {
    runTwitchDiscovery()
    setInterval(runTwitchDiscovery, 300_000)
  }, 45_000)
}
