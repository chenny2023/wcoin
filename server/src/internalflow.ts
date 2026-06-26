import { db, stateGet, stateSet } from './db.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Internal-flow marker. A transfer is "internal" when its counterparty is itself a
// watched casino address — casino↔casino consolidation/churn, plus the same transfer
// recorded once under each watched side (double-count). Volume metrics want these
// EXCLUDED, but a per-row `NOT EXISTS` over 57M rows blocked the hot path.
//
// We precompute a `cp_internal` flag. Each cycle has a fixed ROW BUDGET: it walks the
// casino-address list (id-cursor, not OFFSET — O(log n) per step) marking each
// address's counterparty transfers via idx_transfers_counterparty, advancing past
// already-marked / empty addresses fast, and STOPPING once it has marked BUDGET rows.
// A hot counterparty (a main hot wallet referenced by 60k+ transfers) is therefore
// spread over many cycles instead of one giant UPDATE that bloats the WAL and stalls
// the loop. Idempotent; loops to re-evaluate as addresses are added. Once `firstpass`
// is set, phase 2 switches volume queries to the cheap `cp_internal=0` filter.
// ─────────────────────────────────────────────────────────────────────────────

const BUDGET = Number(process.env.INTERNAL_MARK_BUDGET ?? 4000) // max rows marked per cycle
const MAX_ADDRS = 2000 // safety cap on addresses scanned per cycle
const CYCLE_MS = 2_000
const nextAddr = db.prepare("SELECT id, address FROM watchlist WHERE category='casino' AND active=1 AND id > ? ORDER BY id LIMIT 1")
const pickIds = db.prepare('SELECT id FROM transfers WHERE counterparty=? AND cp_internal=0 LIMIT ?')
const markId = db.prepare('UPDATE transfers SET cp_internal=1 WHERE id=?')

let lastId = 0 // id-cursor into the casino-address list

async function markOnce() {
  let budget = BUDGET
  for (let n = 0; n < MAX_ADDRS && budget > 0; n++) {
    const row = nextAddr.get(lastId) as { id: number; address: string } | undefined
    if (!row) {
      // wrapped the whole list → a full pass is done
      if (lastId > 0 && stateGet('internalflow:firstpass') !== '1') {
        stateSet('internalflow:firstpass', '1')
        console.log('[internal] first full pass complete — cp_internal is now authoritative')
      }
      lastId = 0
      break
    }
    const ask = budget
    const ids = pickIds.all(row.address, ask) as { id: number }[]
    if (ids.length) {
      db.transaction((b: { id: number }[]) => {
        for (const x of b) markId.run(x.id)
      })(ids)
      budget -= ids.length
    }
    // advance only when the address is fully drained (returned fewer than asked); if it
    // filled the remaining budget it may have more → re-process it next cycle, same id.
    if (ids.length < ask) lastId = row.id
    else break
  }
}

export function startInternalFlow() {
  if (process.env.INTERNAL_MARK === '0') {
    console.log('[internal] disabled')
    return
  }
  const done = stateGet('internalflow:firstpass') === '1'
  console.log(`[internal] internal-flow marker active${done ? ' (first pass done — incremental re-eval)' : ' (first pass pending)'}`)
  const loop = async () => {
    try {
      await markOnce()
    } catch (e) {
      console.warn('[internal]', (e as Error).message)
    } finally {
      setTimeout(loop, CYCLE_MS)
    }
  }
  setTimeout(loop, 120_000) // start well after boot settles
}
