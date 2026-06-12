# Labeled-data pipeline — what was added to reach launch

**Problem:** the attribution layer (address → casino) shipped with ~45 casino
labels, almost all *legacy 2017–2018 Ethereum dice dApps* (Etheroll, Dice2Win,
FCK…) and **zero attributed TRON casinos**. None of the modern, high-volume
brands operators actually care about were present. There is no clean public
keyless dump of modern crypto-casino wallets — which is exactly why this product
needs a harvesting pipeline rather than a one-off list.

## The fix: four independent, verifiable label sources (no guessing)

1. **Curated, name-tagged hot wallets** — `server/src/data/curated-labels.json`.
   20 modern brands whose hot wallets carry a **public block-explorer name-tag**
   (the same authoritative attribution class the product already trusts): Stake
   (×3), Rollbit, Roobet, Gamdom, BC.Game (×5), Duelbits, BetFury, Bitcasino,
   500 Casino, CSGO500, Crypto.Games, MetaWin, 1xBet. Every entry has a `source`
   field and is verifiable by opening its explorer page. Loads **instantly on
   every boot** so the leaderboard shows real, relevant casinos immediately.

2. **EVM gambling dumps across 9 chains** — the harvester now pulls the
   Etherscan-label "gambling" lists for etherscan, bscscan, polygonscan,
   arbiscan, optimism, base, fantom, avalanche and gnosis (was: ETH only).
   Casinos reuse the same `0x` address across EVM chains, so any gambling tag is
   applied to the ETH mainnet indexer. Missing/empty chain files are tolerated.

3. **Tron `addressTag` harvest** — unchanged; keyless top-1000 USDT holders,
   casino/exchange keyword-classified, unknown tags skipped.

4. **Behavioural graph discovery + classification** — unchanged engine, but now
   seeded with far more real casino reference sets (item 1), so it classifies
   unnamed TRON/ETH service wallets as `casino-pattern` with higher confidence.
   This is the engine that produces **volume from the platform's own indexed
   flow** — it scales as the indexer runs.

## Verified result (boot-time static set, before runtime harvest/discovery)

| | before | after |
|---|---|---|
| casino-labeled wallets | 45 | **64** |
| of which modern high-volume brands | ~2 | **21** |
| attributed TRON casinos at boot | 0 | via runtime tag-harvest + graph discovery |

Integration-tested by replaying the exact harvester logic against a fresh DB:
dedup is correct (Stake.com and wolf.bet collapse across curated + dump),
address formats validated, empty source files tolerated. `tsc -b` passes.

## Files changed
- `server/src/data/curated-labels.json` — **new** curated, sourced dataset
- `server/src/collectors/labels.ts` — multi-source harvester + instant curated load on boot
- `README.md` — "What is real" attribution row updated

No new dependencies. The pipeline stays keyless and honors the project's
"nothing invented / publicly-documented only" rule.
