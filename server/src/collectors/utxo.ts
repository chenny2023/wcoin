import { db, stmt, stateGet, stateSet, WatchRow } from '../db.ts'
import { emitTransfer } from '../bus.ts'
import { webFetch } from '../net.ts'
import { priceForDay } from './prices.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Generic UTXO collector (Bitcoin + Litecoin) over the Esplora API. UTXO chains
// have no token contracts and no eth_getLogs, so per watched address we pull its
// recent transactions, net the value moving in/out of the address, and value it
// at the coin's historical (block-time) price. Forward-only, resuming from the
// last seen txid per address. Esplora hosts: blockstream.info (BTC),
// litecoinspace.org (LTC) — both keyless.
// ─────────────────────────────────────────────────────────────────────────────

interface UtxoChain {
  key: string // 'BTC' | 'LTC'
  asset: string // price asset
  api: string // esplora base
  pollMs: number
}

const CHAINS: UtxoChain[] = [
  { key: 'BTC', asset: 'BTC', api: 'https://blockstream.info/api', pollMs: 20_000 },
  { key: 'LTC', asset: 'LTC', api: 'https://litecoinspace.org/api', pollMs: 20_000 },
]

const enabled = (key: string) => process.env[`${key}_ENABLED`] !== '0'

async function esplora(api: string, path: string): Promise<any | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await webFetch(api + path, { signal: AbortSignal.timeout(15_000) })
      if (r.ok) return await r.json()
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 1500))
  }
  return null
}

// net the value (sats) flowing into / out of `addr` in one tx, and identify the
// dominant counterparty address on the opposite side
function settle(tx: any, addr: string): { dir: 'in' | 'out'; coins: number; counterparty: string } | null {
  let received = 0
  for (const o of tx.vout ?? []) if (o.scriptpubkey_address === addr) received += o.value ?? 0
  let sent = 0
  for (const i of tx.vin ?? []) if (i.prevout?.scriptpubkey_address === addr) sent += i.prevout.value ?? 0
  if (received === 0 && sent === 0) return null
  const net = received - sent
  if (net > 0) {
    // deposit — counterparty = largest input address that isn't us
    const ins = new Map<string, number>()
    for (const i of tx.vin ?? []) { const a = i.prevout?.scriptpubkey_address; if (a && a !== addr) ins.set(a, (ins.get(a) ?? 0) + (i.prevout.value ?? 0)) }
    const cp = [...ins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'coinbase'
    return { dir: 'in', coins: net / 1e8, counterparty: cp }
  } else {
    const outs = new Map<string, number>()
    for (const o of tx.vout ?? []) { const a = o.scriptpubkey_address; if (a && a !== addr) outs.set(a, (outs.get(a) ?? 0) + (o.value ?? 0)) }
    const cp = [...outs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
    return { dir: 'out', coins: -net / 1e8, counterparty: cp }
  }
}

let rr = 0
async function indexChain(ch: UtxoChain) {
  const watched = (stmt.activeWatch.all() as WatchRow[]).filter((w) => w.chain === ch.key)
  if (watched.length === 0) return
  const w = watched[rr % watched.length]
  rr++
  const seenKey = `${ch.key.toLowerCase()}:seen:${w.address}`
  const lastSeen = stateGet(seenKey)
  const txs = await esplora(ch.api, `/address/${w.address}/txs`)
  if (!Array.isArray(txs) || txs.length === 0) return

  let added = 0
  let newest: string | null = null
  // esplora returns newest-first; walk until we hit lastSeen, insert oldest-first
  const fresh: any[] = []
  for (const tx of txs) {
    if (tx.txid === lastSeen) break
    fresh.push(tx)
  }
  for (const tx of fresh.reverse()) {
    const s = settle(tx, w.address)
    if (!s) continue
    const ts = (tx.status?.block_time ?? Math.floor(Date.now() / 1000)) * 1000
    const price = priceForDay(ch.asset, ts)
    const usd = s.coins * price
    if (!(usd > 0)) continue
    const rec = {
      chain: ch.key,
      tx_hash: tx.txid,
      log_index: 0,
      token: ch.asset,
      from_addr: s.dir === 'in' ? s.counterparty : w.address,
      to_addr: s.dir === 'in' ? w.address : s.counterparty,
      counterparty: s.counterparty,
      amount: s.coins,
      usd,
      watch_id: w.id,
      label: w.label,
      category: w.category,
      direction: s.dir,
      block: tx.status?.block_height ?? 0,
      ts,
    }
    const r = stmt.insertTransfer.run(rec)
    if (r.changes > 0) {
      added++
      if (Date.now() - ts < 600_000) emitTransfer(rec)
    }
  }
  newest = txs[0]?.txid ?? null
  if (newest) stateSet(seenKey, newest)
  if (added) console.log(`[${ch.key.toLowerCase()}] ${w.label}: +${added} transfers`)
}

export function startUtxo() {
  for (const ch of CHAINS) {
    if (!enabled(ch.key)) { console.log(`[${ch.key.toLowerCase()}] disabled`); continue }
    console.log(`[${ch.key.toLowerCase()}] ${ch.key} collector active (Esplora, historically priced)`)
    const loop = async () => {
      try { await indexChain(ch) } catch (e) { console.warn(`[${ch.key.toLowerCase()}]`, (e as Error).message) }
      finally { setTimeout(loop, ch.pollMs) }
    }
    setTimeout(loop, 35_000)
  }
}
