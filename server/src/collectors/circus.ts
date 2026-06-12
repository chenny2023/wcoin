import { config, TRANSFER_TOPIC } from '../config.ts'
import { db, stmt, stateGet, stateSet } from '../db.ts'
import { webFetch } from '../net.ts'
import { rpc as evmRpc } from './evm.ts'
import { evmChains } from './evmchains.ts'
import { b58ToHex20, hex20ToB58 } from '../tronaddr.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Casino-wallet attribution via the public circus.fyi whale feed.
//
// circus.fyi publishes a live "whale transactions" feed on /blockchain in which
// every large transfer is attributed to a named casino. The feed ships the
// public transaction HASH and the casino name — not the wallet address. We take
// the one piece of attribution (casino ↔ tx) and independently verify + extract
// the wallet from PUBLIC chain data: resolve the tx receipt, take the casino
// side of the largest stablecoin transfer (recipient for a deposit, sender for a
// withdrawal). The resulting address joins our watchlist and our own indexer
// builds its full real flow history — we copy no metrics, only follow a public
// lead and confirm it on-chain.
//
// Validated: the Stake whale tx resolves to 0x974caa59…ecc400, matching the
// independently Wayback-attributed Stake.com wallet.
// ─────────────────────────────────────────────────────────────────────────────

const FEED_URL = 'https://circus.fyi/blockchain'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// EVM chains we can resolve a tx on: chain key → rpc + stablecoin set. ETH keeps
// its dedicated collector; BSC/BASE/ARB/OP come from the EVM-chain registry.
const EVM_RESOLVERS: Record<string, { rpc: (m: string, p: unknown[]) => Promise<any>; stable: string[] }> = {
  ETH: { rpc: evmRpc, stable: config.evmTokens.map((t) => t.address.toLowerCase()) },
}
for (const c of evmChains) {
  EVM_RESOLVERS[c.key] = { rpc: c.rpc, stable: c.stable }
}
// circus labels Polygon as either "MATIC" or "POLYGON" — alias to our key
if (EVM_RESOLVERS.POLYGON) EVM_RESOLVERS.MATIC = EVM_RESOLVERS.POLYGON

const NAME_RE = /"children":"([A-Z][A-Za-z0-9.\s]{1,22})"\}/g
const CHAIN_RE = /"children":"(ETH|TRX|BSC|SOL|ARB|BASE|AVAX|OP|MATIC|POLYGON|XRP|BTC|LTC)"\}/g
const NAME_NOISE = /^(View|Hash|ago|hours|min|Deposit|Withdraw|Whale|Live|Transaction|Amount|Chain|Casino)$/i

interface WhaleRow {
  casino: string
  hash: string
  chain: string
  dir: 'in' | 'out'
}

async function fetchFeed(): Promise<WhaleRow[]> {
  const res = await webFetch(FEED_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g)].map((m) => m[1])
  let blob = ''
  for (const c of chunks) {
    try { blob += JSON.parse('"' + c + '"') } catch { blob += c }
  }
  const rows: WhaleRow[] = []
  // any explorer tx link — EVM `/tx/0x<64>` or TRON `/transaction/<64>`; the
  // chain comes from the row's chain pill, the hash is stored as the chain wants
  for (const m of blob.matchAll(/\/(?:tx|transaction)\/(0x)?([0-9a-fA-F]{64})/g)) {
    const at = m.index ?? 0
    const before = blob.slice(Math.max(0, at - 1800), at)
    const names = [...before.matchAll(NAME_RE)].map((x) => x[1].trim()).filter((n) => !NAME_NOISE.test(n) && !/^(ETH|TRX|BSC|SOL|ARB|BASE|AVAX|OP|MATIC|POLYGON|XRP|BTC|LTC)$/.test(n))
    const casino = names[names.length - 1]
    if (!casino) continue
    const dir: 'in' | 'out' = before.lastIndexOf('arrow-down-left') > before.lastIndexOf('arrow-up-right') ? 'in' : 'out'
    const chains = [...before.matchAll(CHAIN_RE)].map((x) => x[1])
    const chain = chains[chains.length - 1] ?? 'ETH'
    const hash = (m[1] ?? '') + m[2] // EVM keeps 0x; TRON is bare hex
    rows.push({ casino, hash, chain, dir })
  }
  return rows
}

// resolve an EVM tx to the casino-side address of its largest stablecoin leg
async function resolveEvmWallet(chain: string, hash: string, dir: 'in' | 'out'): Promise<string | null> {
  const r = EVM_RESOLVERS[chain]
  if (!r) return null
  const rc = await r.rpc('eth_getTransactionReceipt', [hash])
  if (!rc?.logs) return null
  let best: { amt: bigint; from: string; to: string } | null = null
  for (const l of rc.logs as any[]) {
    if (!r.stable.includes(l.address.toLowerCase()) || l.topics?.[0] !== TRANSFER_TOPIC) continue
    const amt = BigInt(l.data === '0x' ? '0x0' : l.data)
    if (!best || amt > best.amt) best = { amt, from: '0x' + l.topics[1].slice(26), to: '0x' + l.topics[2].slice(26) }
  }
  if (!best) return null
  return (dir === 'in' ? best.to : best.from).toLowerCase()
}

// resolve a TRON tx to the casino-side TRC20-USDT address (returns base58)
const TRON_TRANSFER = TRANSFER_TOPIC.replace(/^0x/, '')
const TRON_USDT_HEX = b58ToHex20(config.tronUsdt.address).toLowerCase()
async function resolveTronWallet(hash: string, dir: 'in' | 'out'): Promise<string | null> {
  const res = await fetch(config.tronApi + '/wallet/gettransactioninfobyid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: hash }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = (await res.json()) as any
  let best: { amt: bigint; from: string; to: string } | null = null
  for (const l of j.log ?? []) {
    if ((l.address ?? '').toLowerCase() !== TRON_USDT_HEX || l.topics?.[0] !== TRON_TRANSFER) continue
    const amt = BigInt('0x' + (l.data || '0'))
    if (!best || amt > best.amt) best = { amt, from: l.topics[1].slice(24), to: l.topics[2].slice(24) }
  }
  if (!best) return null
  return hex20ToB58(dir === 'in' ? best.to : best.from)
}

function alreadyWatched(chain: string, address: string): boolean {
  return !!db.prepare('SELECT 1 FROM watchlist WHERE chain=? AND address=?').get(chain, address)
}

const isTron = (chain: string) => chain === 'TRX' || chain === 'TRON'

export async function runCircusOnce() {
  let rows: WhaleRow[]
  try {
    rows = await fetchFeed()
  } catch (e) {
    console.warn('[circus] feed fetch failed:', (e as Error).message)
    return
  }
  let added = 0
  for (const row of rows) {
    const tron = isTron(row.chain)
    // resolve on the chains we can: every registered EVM chain, plus TRON. Other
    // chains' rows (SOL, XRP, BTC, LTC) are skipped until their collectors exist
    if (!tron && !EVM_RESOLVERS[row.chain]) continue
    const seenKey = `circus:tx:${row.hash}`
    if (stateGet(seenKey)) continue
    try {
      const wallet = tron ? await resolveTronWallet(row.hash, row.dir) : await resolveEvmWallet(row.chain, row.hash, row.dir)
      stateSet(seenKey, 1)
      if (!wallet) continue
      // EVM wallets stored under canonical 'ETH' (every EVM indexer watches all
      // 0x addresses); TRON wallets stored under 'TRON'
      const storeChain = tron ? 'TRON' : 'ETH'
      if (alreadyWatched(storeChain, wallet)) continue
      stmt.addWatch.run(storeChain, wallet, row.casino.slice(0, 48), 'casino', Date.now())
      added++
      console.log(`[circus] attributed ${row.casino} → ${wallet} (${row.chain} whale tx, ${row.dir})`)
    } catch (e) {
      console.warn(`[circus] resolve ${row.hash.slice(0, 12)}… failed:`, (e as Error).message)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  if (added) console.log(`[circus] +${added} new casino wallets this sweep`)
}

export function startCircus() {
  console.log('[circus] casino-attribution feed active (whale-tx resolution)')
  const loop = async () => {
    await runCircusOnce().catch((e) => console.warn('[circus]', (e as Error).message))
    setTimeout(loop, 5 * 60_000) // every 5 min — feed refreshes, accumulates new casinos
  }
  setTimeout(loop, 20_000)
}
