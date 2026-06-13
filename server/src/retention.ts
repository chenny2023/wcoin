import { db } from './db.ts'
import { config } from './config.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Transfer retention. The indexed `transfers` table is the only unbounded
// table — on a size-capped volume it eventually fills the disk and SQLite
// starts throwing `disk I/O error`. When RETAIN_DAYS > 0 we delete transfers
// older than the window in small, checkpointed batches: each batch's WAL stays
// tiny and is truncated immediately, so the prune itself survives a near-full
// disk, and the freed pages are reused by ongoing indexing — capping the file
// size in place without an (impossible-on-a-full-disk) VACUUM.
// ─────────────────────────────────────────────────────────────────────────────

const BATCH = 20_000

export async function pruneOldTransfers(): Promise<number> {
  if (!(config.retainDays > 0)) return 0
  const cutoff = Date.now() - config.retainDays * 86_400_000
  const before = (db.prepare('SELECT COUNT(*) n FROM transfers WHERE ts < ?').get(cutoff) as any).n as number
  if (!before) return 0
  console.log(`[retention] pruning ${before} transfers older than ${config.retainDays}d…`)
  const del = db.prepare(
    'DELETE FROM transfers WHERE rowid IN (SELECT rowid FROM transfers WHERE ts < ? LIMIT ?)',
  )
  // reclaim WAL space up front so the first batches have room to write
  try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
  let deleted = 0
  for (;;) {
    let changes = 0
    try {
      changes = del.run(cutoff, BATCH).changes
    } catch (e) {
      console.warn('[retention] batch failed (will retry next cycle):', (e as Error).message)
      break
    }
    deleted += changes
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
    if (changes < BATCH) break
    await new Promise((r) => setImmediate(r)) // yield so the API/event loop stays responsive
  }
  console.log(`[retention] pruned ${deleted} transfers; freed pages are reused so the DB file stops growing`)
  return deleted
}

export function startRetention() {
  if (!(config.retainDays > 0)) {
    console.log('[retention] disabled (set RETAIN_DAYS to enable)')
    return
  }
  // periodic prune; the initial pass is run explicitly at boot in server.ts
  setInterval(() => {
    pruneOldTransfers().catch((e) => console.warn('[retention] prune failed:', (e as Error).message))
  }, 6 * 3600_000)
}
