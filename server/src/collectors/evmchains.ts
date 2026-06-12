import { config } from '../config.ts'
import { makeEvmChain, EvmChain } from './evmchain.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Registry of the extra EVM chains we index beyond mainnet ETH (which keeps its
// own dedicated evm.ts collector). Each entry is a thin config over the generic
// factory. Casinos reuse the same 0x hot wallet across these chains, so every
// watchlist address is indexed on all of them — matching circus.fyi's per-chain
// deposit breakdown. Public keyless nodes; only BSC needs proxy routing.
// ─────────────────────────────────────────────────────────────────────────────

const CHAINS: EvmChain[] = []

if (config.bscEnabled) {
  CHAINS.push(
    makeEvmChain({
      key: 'BSC',
      name: 'BNB Chain',
      rpcs: config.bscRpcs,
      tokens: config.bscTokens, // 18-decimal BEP20
      explorerHosts: ['bscscan.com'],
      maxRange: config.bscMaxRange,
      pollMs: config.bscPollMs,
      maxRangesPerTick: config.bscMaxRangesPerTick,
      backfillBlocks: config.bscBackfillBlocks,
      nominalBlockMs: 3_000,
      useProxy: true,
    }),
  )
}

// L2s — native USDC (6-dec); publicnode endpoints reachable direct, generous
// getLogs ranges. Disable any with <CHAIN>_ENABLED=0.
const L2S = [
  {
    key: 'BASE',
    name: 'Base',
    env: 'BASE',
    rpcs: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
    tokens: [{ symbol: 'USDC', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 }],
    explorerHosts: ['basescan.org'],
    nominalBlockMs: 2_000,
  },
  {
    key: 'ARB',
    name: 'Arbitrum',
    env: 'ARB',
    rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
    tokens: [
      { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 },
      { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
    ],
    explorerHosts: ['arbiscan.io'],
    nominalBlockMs: 250,
  },
  {
    key: 'OP',
    name: 'Optimism',
    env: 'OP',
    rpcs: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
    tokens: [
      { symbol: 'USDC', address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals: 6 },
      { symbol: 'USDT', address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6 },
    ],
    explorerHosts: ['optimistic.etherscan.io'],
    nominalBlockMs: 2_000,
  },
] as const

for (const c of L2S) {
  if (process.env[`${c.env}_ENABLED`] === '0') continue
  CHAINS.push(
    makeEvmChain({
      key: c.key,
      name: c.name,
      rpcs: c.rpcs,
      tokens: c.tokens,
      explorerHosts: c.explorerHosts,
      maxRange: Number(process.env[`${c.env}_MAX_RANGE`] ?? 1500),
      pollMs: Number(process.env[`${c.env}_POLL_MS`] ?? 15_000),
      maxRangesPerTick: Number(process.env[`${c.env}_MAX_RANGES`] ?? 10),
      backfillBlocks: Number(process.env[`${c.env}_BACKFILL_BLOCKS`] ?? 600),
      nominalBlockMs: c.nominalBlockMs,
      useProxy: false,
    }),
  )
}

export const evmChains = CHAINS
export const evmChainByKey = new Map(CHAINS.map((c) => [c.key, c]))

// host → chain key, for circus whale-feed tx resolution
export const evmChainByExplorerHost = new Map<string, EvmChain>()
for (const c of CHAINS) for (const h of c.explorerHosts) evmChainByExplorerHost.set(h, c)

export function startEvmChains() {
  for (const c of CHAINS) c.start()
}

export function evmChainsBalanceUsd(address: string): Promise<number>[] {
  return CHAINS.map((c) => c.balanceUsd(address))
}
