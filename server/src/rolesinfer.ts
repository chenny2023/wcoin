import { db } from './db.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Wallet-role inference (open-data `wallet_role`). Behaviour-OBSERVED, never
// guessed: each active casino wallet is classified from its own transfer stats
// over a rolling window, with conservative thresholds; anything ambiguous stays
// NULL. Published taxonomy (see the open-data DATA_DICTIONARY):
//   hot_wallet      — two-way flow, high frequency, many distinct counterparties
//                     (an operating cashier wallet)
//   deposit_address — external inflow whose outflow is (almost) all internal
//                     sweeps to the operator's own wallets (cp_internal=1)
//   dormant         — no transfers at all in the window (NOT asserted to be cold
//                     storage — inactivity is the only claim)
//   NULL            — mixed/ambiguous; no claim made
//
// Runs as a slow background pass (id-cursor, small batches, yields between
// cycles) so the 60M-row transfers table is only ever touched via the
// idx_transfers_watch index — same discipline as the cp_internal marker.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_DAYS = Number(process.env.ROLE_WINDOW_DAYS ?? 14)
const ADDRS_PER_CYCLE = Number(process.env.ROLE_ADDRS_PER_CYCLE ?? 40)
const CYCLE_MS = 3_000
// conservative thresholds — documented in the open-data dictionary
const HOT_MIN_TX = 50
const HOT_MIN_CPS = 20
const DEP_MIN_IN = 5
const DEP_SWEEP_SHARE = 0.8

const nextAddr = db.prepare("SELECT id FROM watchlist WHERE category='casino' AND active=1 AND id > ? ORDER BY id LIMIT ?")
const statsQ = db.prepare(`
  SELECT COUNT(*) n,
         SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) nin,
         SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) nout,
         SUM(CASE WHEN direction='out' AND cp_internal=1 THEN 1 ELSE 0 END) sweeps,
         COUNT(DISTINCT counterparty) cps
  FROM transfers WHERE watch_id=? AND ts>?`)
const setRole = db.prepare('UPDATE watchlist SET role=?, role_at=? WHERE id=?')

export function classify(s: { n: number; nin: number; nout: number; sweeps: number; cps: number }): string | null {
  if (s.n === 0) return 'dormant'
  if (s.nin > 0 && s.nout > 0 && s.n >= HOT_MIN_TX && s.cps >= HOT_MIN_CPS) return 'hot_wallet'
  if (s.nin >= DEP_MIN_IN && s.nout > 0 && s.sweeps / s.nout >= DEP_SWEEP_SHARE) return 'deposit_address'
  return null // ambiguous — publish no claim
}

let cursor = 0

function inferOnce() {
  const since = Date.now() - WINDOW_DAYS * 86_400_000
  const rows = nextAddr.all(cursor, ADDRS_PER_CYCLE) as { id: number }[]
  if (rows.length === 0) {
    cursor = 0 // full pass done — wrap and keep refreshing
    return
  }
  const now = Date.now()
  for (const r of rows) {
    const s = statsQ.get(r.id, since) as any
    setRole.run(classify({ n: s.n ?? 0, nin: s.nin ?? 0, nout: s.nout ?? 0, sweeps: s.sweeps ?? 0, cps: s.cps ?? 0 }), now, r.id)
    cursor = r.id
  }
}

export function startRoleInference() {
  if (process.env.ROLE_INFER_ENABLED === '0') return
  console.log(`[roles] wallet-role inference active (${WINDOW_DAYS}d window, ${ADDRS_PER_CYCLE} addrs / ${CYCLE_MS}ms)`)
  const loop = () => {
    try {
      inferOnce()
    } catch (e) {
      console.warn('[roles]', (e as Error).message)
    } finally {
      setTimeout(loop, CYCLE_MS).unref?.()
    }
  }
  setTimeout(loop, 120_000) // start after boot settles
}
