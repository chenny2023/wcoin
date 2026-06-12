import { db, stmt, stateGet, stateSet, WatchRow } from '../db.ts'
import { emitTransfer } from '../bus.ts'
import { webFetch } from '../net.ts'
import { priceForDay } from './prices.ts'

// ─────────────────────────────────────────────────────────────────────────────
// XRP Ledger collector. The XRPL has its own model: per watched account we pull
// account_tx via public JSON-RPC and index Payment transactions. Native XRP
// (drops) is valued at the historical price; issued stablecoins (RLUSD/USD…)
// count 1:1. Forward-only, resuming from the last seen ledger index.
// XRPL epoch starts 2000-01-01, so ripple-time + 946684800 = unix time.
// ─────────────────────────────────────────────────────────────────────────────

const RPC = process.env.XRPL_RPC || 'https://xrplcluster.com/'
const RIPPLE_EPOCH = 946_684_800
const POLL_MS = 20_000
const STABLE_CCY = new Set(['USD', 'USDC', 'USDT', 'RLUSD'])

export const xrpEnabled = () => process.env.XRP_ENABLED !== '0'

async function rpc(method: string, params: unknown[]): Promise<any | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await webFetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(15_000),
      })
      if (r.ok) {
        const j = (await r.json()) as any
        if (j.result && j.result.status !== 'error') return j.result
      }
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 1500))
  }
  return null
}

// value one Payment delivered amount in USD; returns null for non-USD non-XRP
function valueDelivered(amount: any, ts: number): { coins: number; usd: number; token: string } | null {
  if (typeof amount === 'string') {
    const xrp = Number(amount) / 1e6 // drops → XRP
    return { coins: xrp, usd: xrp * priceForDay('XRP', ts), token: 'XRP' }
  }
  if (amount && typeof amount === 'object') {
    if (!STABLE_CCY.has(amount.currency)) return null // skip exotic issued tokens
    const v = Number(amount.value)
    return { coins: v, usd: v, token: amount.currency } // USD-pegged issued ≈ 1:1
  }
  return null
}

let rr = 0
async function indexAccount(w: WatchRow) {
  const acct = w.address
  const seenKey = `xrp:ledger:${acct}`
  const marker = Number(stateGet(seenKey) ?? 0)
  const res = await rpc('account_tx', [{ account: acct, ledger_index_min: marker || -1, limit: 30, binary: false }])
  if (!res?.transactions) return

  let added = 0
  let maxLedger = marker
  // process oldest→newest
  const txs = [...res.transactions].reverse()
  for (const entry of txs) {
    const tx = entry.tx ?? entry.tx_json ?? entry
    const meta = entry.meta
    if (!tx || tx.TransactionType !== 'Payment') continue
    if (meta && meta.TransactionResult !== 'tesSUCCESS') continue
    const ledger = tx.ledger_index ?? entry.ledger_index ?? 0
    if (ledger > maxLedger) maxLedger = ledger
    const ts = ((tx.date ?? 0) + RIPPLE_EPOCH) * 1000
    const delivered = meta?.delivered_amount ?? tx.Amount
    const v = valueDelivered(delivered, ts)
    if (!v || !(v.usd > 0)) continue
    const isIn = tx.Destination === acct
    const isOut = tx.Account === acct
    if (!isIn && !isOut) continue
    const counterparty = isIn ? tx.Account : tx.Destination
    const rec = {
      chain: 'XRP',
      tx_hash: tx.hash ?? entry.hash,
      log_index: 0,
      token: v.token,
      from_addr: isIn ? counterparty : acct,
      to_addr: isIn ? acct : counterparty,
      counterparty,
      amount: v.coins,
      usd: v.usd,
      watch_id: w.id,
      label: w.label,
      category: w.category,
      direction: (isIn ? 'in' : 'out') as 'in' | 'out',
      block: ledger,
      ts,
    }
    const r = stmt.insertTransfer.run(rec)
    if (r.changes > 0) {
      added++
      if (Date.now() - ts < 600_000) emitTransfer(rec)
    }
  }
  if (maxLedger > marker) stateSet(seenKey, maxLedger)
  if (added) console.log(`[xrp] ${w.label}: +${added} transfers`)
}

export function startXrp() {
  if (!xrpEnabled()) { console.log('[xrp] disabled'); return }
  console.log('[xrp] XRP Ledger collector active (account_tx, historically priced)')
  const loop = async () => {
    const watched = (stmt.activeWatch.all() as WatchRow[]).filter((w) => w.chain === 'XRP')
    if (watched.length > 0) {
      const w = watched[rr % watched.length]
      rr++
      try { await indexAccount(w) } catch (e) { console.warn('[xrp]', (e as Error).message) }
    }
    setTimeout(loop, POLL_MS)
  }
  setTimeout(loop, 35_000)
}
