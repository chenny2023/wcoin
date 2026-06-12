import { db } from '../db.ts'
import { webFetch } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Compliance / risk layer — flags watched entities that transact with
// OFAC-sanctioned addresses (which include the Tornado Cash mixer pools). The
// source is the maintained public mirror of the OFAC SDN crypto list. We load
// the per-chain lists, then periodically scan our own transfer graph: any
// watched entity whose counterparty set intersects a sanctioned address gets a
// risk flag with the hit count and total value. This is the compliance hook a
// regulated operator's risk team actually pays for.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/'
// our chains: ETH (covers all EVM — addresses reused), TRON, SOL
const LISTS: { file: string; chain: string; lower: boolean }[] = [
  { file: 'sanctioned_addresses_ETH.txt', chain: 'ETH', lower: true },
  { file: 'sanctioned_addresses_TRX.txt', chain: 'TRON', lower: false },
  { file: 'sanctioned_addresses_SOL.txt', chain: 'SOL', lower: false },
]
const REFRESH_DAYS = 3

const upsertAddr = db.prepare(`
  INSERT OR IGNORE INTO risk_addresses(address, chain, category, source, added_at)
  VALUES(?, ?, 'sanctioned', 'OFAC', ?)
`)
const upsertFlag = db.prepare(`
  INSERT INTO risk_flags(watch_id, hits, usd, last_ts, addresses, updated_at)
  VALUES(@watch_id, @hits, @usd, @last_ts, @addresses, @updated_at)
  ON CONFLICT(watch_id) DO UPDATE SET hits=excluded.hits, usd=excluded.usd, last_ts=excluded.last_ts, addresses=excluded.addresses, updated_at=excluded.updated_at
`)

async function fetchList(file: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await webFetch(BASE + file, { signal: AbortSignal.timeout(25_000) })
      if (res.ok) return await res.text()
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

// returns the per-chain address counts loaded this run
async function loadLists(): Promise<Record<string, number>> {
  const now = Date.now()
  const counts: Record<string, number> = {}
  for (const { file, chain, lower } of LISTS) {
    const text = await fetchList(file)
    if (text === null) {
      console.warn(`[risk] ${file} unreachable after retries`)
      continue
    }
    let n = 0
    const tx = db.transaction(() => {
      for (const raw of text.split('\n')) {
        const addr = raw.trim()
        if (!addr || addr.startsWith('#')) continue
        upsertAddr.run(lower ? addr.toLowerCase() : addr, chain, now)
        n++
      }
    })
    tx()
    counts[chain] = n
  }
  return counts
}

// scan the transfer graph for counterparties on the sanctioned list. The
// counterparty index makes this a set of point lookups (≈150 addresses) rather
// than a full scan.
export function evalRisk() {
  const rows = db
    .prepare(
      `SELECT t.watch_id AS watch_id, COUNT(*) AS hits, SUM(t.usd) AS usd, MAX(t.ts) AS last_ts,
              GROUP_CONCAT(DISTINCT t.counterparty) AS addrs
       FROM transfers t JOIN risk_addresses r ON t.counterparty = r.address
       GROUP BY t.watch_id`,
    )
    .all() as { watch_id: number; hits: number; usd: number; last_ts: number; addrs: string }[]
  // clear stale flags that no longer have hits
  const flagged = new Set(rows.map((r) => r.watch_id))
  for (const f of db.prepare('SELECT watch_id FROM risk_flags').all() as { watch_id: number }[]) {
    if (!flagged.has(f.watch_id)) db.prepare('DELETE FROM risk_flags WHERE watch_id=?').run(f.watch_id)
  }
  const now = Date.now()
  for (const r of rows) {
    upsertFlag.run({
      watch_id: r.watch_id,
      hits: r.hits,
      usd: r.usd ?? 0,
      last_ts: r.last_ts,
      addresses: JSON.stringify((r.addrs ?? '').split(',').slice(0, 5)),
      updated_at: now,
    })
  }
  if (rows.length) console.log(`[risk] ${rows.length} watched entities have sanctioned-counterparty exposure`)
}

// watch_id → risk flag, for aggregation
export function riskFlags(): Map<number, { hits: number; usd: number; addresses: string[] }> {
  const rows = db.prepare('SELECT watch_id, hits, usd, addresses FROM risk_flags').all() as any[]
  return new Map(rows.map((r) => [r.watch_id, { hits: r.hits, usd: r.usd, addresses: JSON.parse(r.addresses ?? '[]') }]))
}

export async function refreshRisk(force = false) {
  const last = Number((db.prepare("SELECT value FROM sync_state WHERE key='risk:lastRun'").get() as any)?.value ?? 0)
  const haveEth = (db.prepare("SELECT COUNT(*) n FROM risk_addresses WHERE chain='ETH'").get() as any).n
  // refresh on schedule, OR immediately if the critical ETH list isn't loaded yet
  if (!force && haveEth > 0 && Date.now() - last < REFRESH_DAYS * 86_400_000) return
  const counts = await loadLists()
  const total = (db.prepare('SELECT COUNT(*) n FROM risk_addresses').get() as any).n
  // only mark complete once the ETH list (our dominant chain) is in
  if ((counts.ETH ?? 0) > 0 || haveEth > 0) {
    db.prepare("INSERT INTO sync_state(key,value) VALUES('risk:lastRun',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Date.now()))
  }
  console.log(`[risk] OFAC sanctioned list loaded — ${total} addresses (${JSON.stringify(counts)})`)
  evalRisk()
}

export function startRisk() {
  refreshRisk().catch((e) => console.warn('[risk] load failed:', (e as Error).message))
  setInterval(() => refreshRisk().catch(() => {}), 12 * 3600_000)
  // re-scan the graph every few minutes (cheap with the counterparty index)
  setTimeout(function loop() {
    try { evalRisk() } catch (e) { console.warn('[risk] eval', (e as Error).message) }
    setTimeout(loop, 5 * 60_000)
  }, 90_000)
}
