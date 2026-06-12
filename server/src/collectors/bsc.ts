import { config, TRANSFER_TOPIC } from '../config.ts'
import { db, stmt, stateGet, stateSet, WatchRow } from '../db.ts'
import { emitTransfer } from '../bus.ts'
import { webFetch } from '../net.ts'

// ─────────────────────────────────────────────────────────────────────────────
// BSC (BNB Chain) collector — EVM-compatible, a dominant crypto-casino rail
// (circus.fyi shows e.g. Stake at ~$486M on BSC). Mirrors the ETH collector's
// eth_getLogs strategy but:
//   • routes through webFetch (public BSC nodes are GFW-blocked direct)
//   • handles 18-decimal BEP20 USDT/USDC
//   • adapts the getLogs range (publicnode caps ~2000 blocks)
//   • indexes EVERY EVM (0x) address in the active watchlist regardless of its
//     `chain` tag — casinos reuse the same hot wallet across EVM chains, so a
//     single watchlist entry (e.g. Stake.com) accrues both ETH and BSC flow.
// Forward indexer + deep historical backfill, both resumable via sync_state.
// ─────────────────────────────────────────────────────────────────────────────

const BLOCK_MS = 3_000
const RANGE_FLOOR = 50

let rpcIdx = 0
export async function bscRpc(method: string, params: unknown[], tries = config.bscRpcs.length * 2): Promise<any> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    const url = config.bscRpcs[rpcIdx % config.bscRpcs.length]
    rpcIdx++
    try {
      const res = await webFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as any
      if (json.error) throw new Error(json.error.message || 'rpc error')
      return json.result
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

const pad = (addr: string) => '0x000000000000000000000000' + addr.toLowerCase().replace(/^0x/, '')
const tokenByAddr = (a: string) => config.bscTokens.find((t) => t.address.toLowerCase() === a.toLowerCase())

function toUnits(dataHex: string, decimals: number): number {
  const v = BigInt(dataHex && dataHex !== '0x' ? dataHex : '0x0')
  const base = 10n ** BigInt(decimals)
  return Number(v / base) + Number(v % base) / Number(base)
}

// every EVM (0x) watchlist address — casinos reuse wallets across EVM chains
function evmWatched(): WatchRow[] {
  return (stmt.activeWatch.all() as WatchRow[]).filter((r) => /^0x[0-9a-fA-F]{40}$/.test(r.address))
}

async function getLogs(from: number, to: number, topicPos: 1 | 2, watched: string[]) {
  return bscRpc('eth_getLogs', [
    {
      address: config.bscTokens.map((t) => t.address),
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16),
      topics: topicPos === 2 ? [TRANSFER_TOPIC, null, watched.map(pad)] : [TRANSFER_TOPIC, watched.map(pad), null],
    },
  ])
}

function insertLogs(logs: any[], byAddr: Map<string, WatchRow>, anchorBlock: number, anchorTs: number, emitRecent: boolean): number {
  let added = 0
  const tx = db.transaction((items: any[]) => {
    for (const log of items) {
      const token = tokenByAddr(log.address)
      if (!token) continue
      const fromA = '0x' + log.topics[1].slice(26)
      const toA = '0x' + log.topics[2].slice(26)
      const watchTo = byAddr.get(toA.toLowerCase())
      const watchFrom = byAddr.get(fromA.toLowerCase())
      const w = watchTo ?? watchFrom
      if (!w) continue
      const amount = toUnits(log.data, token.decimals)
      if (!(amount > 0)) continue
      const block = Number(BigInt(log.blockNumber))
      const ts = anchorTs - (anchorBlock - block) * BLOCK_MS
      const rec = {
        chain: 'BSC',
        tx_hash: log.transactionHash,
        log_index: Number(BigInt(log.logIndex ?? '0x0')),
        token: token.symbol,
        from_addr: fromA,
        to_addr: toA,
        counterparty: watchTo ? fromA : toA,
        amount,
        usd: amount,
        watch_id: w.id,
        label: w.label,
        category: w.category,
        direction: watchTo ? ('in' as const) : ('out' as const),
        block,
        ts,
      }
      const r = stmt.insertTransfer.run(rec)
      if (r.changes > 0) {
        added++
        if (emitRecent && Date.now() - ts < 600_000) emitTransfer(rec)
      }
    }
  })
  tx(logs)
  return added
}

// ── forward indexer ───────────────────────────────────────────────────────────
let fwdRange = 0
export async function runBscOnce() {
  const watched = evmWatched()
  if (watched.length === 0) return
  const byAddr = new Map(watched.map((w) => [w.address.toLowerCase(), w]))
  const hexes = watched.map((w) => w.address.toLowerCase())

  const head = Number(BigInt(await bscRpc('eth_blockNumber', [])))
  let last = Number(stateGet('bsc:lastBlock') ?? 0)
  if (last === 0) last = head - config.bscBackfillBlocks
  if (last >= head) return

  if (!fwdRange) fwdRange = config.bscMaxRange
  let ranges = 0
  let from = last + 1
  while (from <= head && ranges < config.bscMaxRangesPerTick) {
    ranges++
    const to = Math.min(from + fwdRange - 1, head)
    try {
      const deposits = await getLogs(from, to, 2, hexes)
      await new Promise((r) => setTimeout(r, 200))
      const withdrawals = await getLogs(from, to, 1, hexes)
      const added = insertLogs([...deposits, ...withdrawals], byAddr, head, Date.now(), true)
      stateSet('bsc:lastBlock', to)
      if (added) console.log(`[bsc] blocks ${from}-${to}: +${added} transfers`)
      from = to + 1
      fwdRange = Math.min(config.bscMaxRange, Math.ceil(fwdRange * 1.4))
    } catch (e) {
      if (fwdRange > RANGE_FLOOR) { fwdRange = Math.max(RANGE_FLOOR, Math.floor(fwdRange / 2)); continue }
      throw e
    }
  }
}

// ── deep historical backfill ──────────────────────────────────────────────────
export async function runBscBackfill() {
  if (config.deepBackfillDays <= 0) return
  const watched = evmWatched()
  if (watched.length === 0) return
  const byAddr = new Map(watched.map((w) => [w.address.toLowerCase(), w]))
  const hexes = watched.map((w) => w.address.toLowerCase())

  let anchorBlock = Number(stateGet('bsc:anchor') ?? 0)
  let anchorTs = Number(stateGet('bsc:anchorTs') ?? 0)
  if (!anchorBlock) {
    anchorBlock = Number(BigInt(await bscRpc('eth_blockNumber', [])))
    anchorTs = Date.now()
    stateSet('bsc:anchor', anchorBlock)
    stateSet('bsc:anchorTs', anchorTs)
  }
  const target = anchorBlock - Math.ceil((config.deepBackfillDays * 86_400_000) / BLOCK_MS)
  let cursor = Number(stateGet('bsc:cursor') ?? anchorBlock)

  if (cursor <= target) {
    const doneCount = Number(stateGet('bsc:doneWatchCount') ?? 0)
    if (doneCount && watched.length >= doneCount + 5) {
      cursor = anchorBlock
      stateSet('bsc:cursor', cursor)
    } else {
      if (!doneCount) stateSet('bsc:doneWatchCount', watched.length)
      return
    }
  }

  let range = config.bscMaxRange
  let failsAtFloor = 0
  console.log(`[bsc] backfill ${cursor} → ${target} (${(((cursor - target) * BLOCK_MS) / 86_400_000).toFixed(1)}d remaining)`)
  let ops = 0
  while (cursor > target && ops < 40) {
    ops++
    const from = Math.max(target, cursor - range)
    try {
      const deposits = await getLogs(from, cursor, 2, hexes)
      await new Promise((r) => setTimeout(r, 250))
      const withdrawals = await getLogs(from, cursor, 1, hexes)
      const added = insertLogs([...deposits, ...withdrawals], byAddr, anchorBlock, anchorTs, false)
      cursor = from - 1
      stateSet('bsc:cursor', cursor)
      range = Math.min(config.bscMaxRange, Math.ceil(range * 1.4))
      failsAtFloor = 0
      if (added > 0) {
        const daysLeft = Math.max(0, ((cursor - target) * BLOCK_MS) / 86_400_000)
        console.log(`[bsc] backfill +${added} · ${daysLeft.toFixed(1)}d left`)
      }
    } catch {
      if (range > RANGE_FLOOR) range = Math.max(RANGE_FLOOR, Math.floor(range / 2))
      else if (++failsAtFloor >= 4) { cursor = from - 1; stateSet('bsc:cursor', cursor); failsAtFloor = 0 }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  if (cursor <= target) {
    stateSet('bsc:doneWatchCount', watched.length)
    console.log(`[bsc] backfill complete — ${config.deepBackfillDays}d of BSC history indexed`)
  }
}

// reserves via balanceOf (BEP20)
export async function bscBalanceUsd(address: string): Promise<number> {
  let total = 0
  for (const t of config.bscTokens) {
    try {
      const data = '0x70a08231' + pad(address).slice(2)
      const res = await bscRpc('eth_call', [{ to: t.address, data }, 'latest'])
      total += toUnits(res, t.decimals)
    } catch { /* skip */ }
  }
  return total
}

export function startBsc() {
  if (!config.bscEnabled) {
    console.log('[bsc] disabled (BSC_ENABLED=0)')
    return
  }
  console.log('[bsc] BNB Chain collector active (via proxy, 18-dec BEP20)')
  const forward = async () => {
    try { await runBscOnce() } catch (e) { console.warn('[bsc] forward error:', (e as Error).message) }
    finally { setTimeout(forward, config.bscPollMs) }
  }
  forward()
  const backfill = async () => {
    try { await runBscBackfill() } catch (e) { console.warn('[bsc] backfill error:', (e as Error).message) }
    finally { setTimeout(backfill, 120_000) }
  }
  setTimeout(backfill, 25_000)
}
