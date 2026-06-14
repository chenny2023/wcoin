import { config } from '../config.ts'
import { db, stmt, stateGet, stateSet, WatchRow } from '../db.ts'
import { emitTransfer } from '../bus.ts'
import { rpc } from './evm.ts'
import { priceForDay } from './prices.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Native-coin (ETH / BNB) deposit & withdrawal scanner.
//
// Our stablecoin rails ride ERC20 Transfer LOGS, which eth_getLogs filters
// cheaply by topic+address. Native value transfers emit NO logs — they live in
// the block's transaction list — and public nodes don't expose trace_filter
// keylessly. So we scan full blocks (eth_getBlockByNumber with txs) and keep the
// ones whose from/to touches a watched casino wallet, priced at block-time USD.
//
// Full-block parsing is heavy, so we BOUND blocks/tick and yield between blocks
// to keep it off the critical path, and we DON'T deep-backfill (re-scanning every
// historical block fully would be far too expensive keyless) — we follow the tip
// from boot forward. At ~1 new ETH block per poll, steady-state cost is tiny;
// only the short boot catch-up window fetches several blocks per tick.
// ─────────────────────────────────────────────────────────────────────────────

const HEX = (n: number) => '0x' + n.toString(16)
const WEI = 10 ** 18

async function scanNativeOnce(
  chainKey: string,
  asset: string,
  rpcs: string[],
  maxBlocksPerTick: number,
  bootWindow: number,
) {
  const rows = stmt.watchByChain.all(chainKey) as WatchRow[]
  if (rows.length === 0) return
  const byAddr = new Map(rows.map((r) => [r.address.toLowerCase(), r]))
  const watched = new Set(rows.map((r) => r.address.toLowerCase()))

  const head = Number(BigInt(await rpc('eth_blockNumber', [], rpcs)))
  const stateKey = `native:${chainKey}:lastBlock`
  let last = Number(stateGet(stateKey) ?? 0)
  if (last === 0) last = head - bootWindow // no deep backfill — start near the tip
  if (last >= head) return

  let scanned = 0
  let hits = 0
  for (let b = last + 1; b <= head; b++) {
    if (scanned >= maxBlocksPerTick) break
    let block: any
    try {
      block = await rpc('eth_getBlockByNumber', [HEX(b), true], rpcs)
    } catch (e) {
      console.warn(`[native ${chainKey}] block ${b} failed, retry next tick:`, (e as Error).message)
      break // don't advance — retry this block next cycle
    }
    if (!block) break
    const tsMs = Number(BigInt(block.timestamp ?? '0x0')) * 1000
    const price = priceForDay(asset, tsMs)
    const recs: any[] = []
    for (const tx of block.transactions ?? []) {
      if (!tx || typeof tx !== 'object' || !tx.hash) continue
      const to = (tx.to ?? '').toLowerCase()
      const from = (tx.from ?? '').toLowerCase()
      const wTo = to && watched.has(to) ? byAddr.get(to) : undefined
      const wFrom = from && watched.has(from) ? byAddr.get(from) : undefined
      if (!wTo && !wFrom) continue
      const wei = BigInt(tx.value ?? '0x0')
      if (wei === 0n) continue // contract call with no native value moved
      const amount = Number(wei) / WEI
      if (!(amount > 0)) continue
      const w = wTo ?? wFrom! // a deposit (to watched) takes priority for labelling
      recs.push({
        chain: chainKey,
        tx_hash: tx.hash,
        log_index: -1, // sentinel: native value transfer, never collides with a real log row
        token: asset,
        from_addr: from,
        to_addr: to,
        counterparty: wTo ? from : to,
        amount,
        usd: amount * price,
        watch_id: w.id,
        label: w.label,
        category: w.category,
        direction: wTo ? 'in' : 'out',
        block: b,
        ts: Date.now(),
      })
    }
    if (recs.length) {
      const insert = db.transaction((items: any[]) => {
        for (const rec of items) {
          const r = stmt.insertTransfer.run(rec)
          if (r.changes > 0) emitTransfer(rec)
        }
      })
      insert(recs)
      hits += recs.length
    }
    scanned++
    stateSet(stateKey, b)
    last = b
    if (b < head) await new Promise((r) => setTimeout(r, 30)) // breathe between heavy full-block parses
  }
  if (hits) console.log(`[native ${chainKey}] +${hits} ${asset} transfers (scanned ${scanned} blocks → ${last})`)
}

function startNativeChain(chainKey: string, asset: string, rpcs: string[], maxBlocksPerTick: number) {
  const loop = async () => {
    try {
      await scanNativeOnce(chainKey, asset, rpcs, maxBlocksPerTick, 40)
    } catch (e) {
      console.warn(`[native ${chainKey}] cycle error:`, (e as Error).message)
    } finally {
      setTimeout(loop, config.evmPollMs)
    }
  }
  loop()
}

export function startNative() {
  if ((process.env.NATIVE_ENABLED ?? '1') === '0') return
  console.log('[native] ETH native-coin deposit scanner active')
  startNativeChain('ETH', 'ETH', config.evmRpcs, 6)
}
