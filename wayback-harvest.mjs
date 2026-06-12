// One-shot: harvest Etherscan nametags from Wayback Machine snapshots for our
// highest-value unattributed ETH counterparties. Public archived pages only.
import Database from 'better-sqlite3'
import { fetch as uf, ProxyAgent } from 'undici'

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890'
const dispatcher = new ProxyAgent(proxyUrl)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new Database('server/data/wcoin.db')

// candidates: top by 7d volume, top by tx count, plus our discovered services
const since = Date.now() - 7 * 86_400_000
const byVol = db.prepare(`
  SELECT t.counterparty a, COUNT(*) tx, SUM(t.usd) vol FROM transfers t
  WHERE t.chain='ETH' AND t.ts>=? AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.chain='ETH' AND w.address=t.counterparty)
  GROUP BY t.counterparty ORDER BY vol DESC LIMIT 60`).all(since)
const byTx = db.prepare(`
  SELECT t.counterparty a, COUNT(*) tx, SUM(t.usd) vol FROM transfers t
  WHERE t.chain='ETH' AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.chain='ETH' AND w.address=t.counterparty)
  GROUP BY t.counterparty ORDER BY tx DESC LIMIT 40`).all()
const services = db.prepare(`SELECT address a, 0 tx, 0 vol FROM watchlist WHERE chain='ETH' AND label LIKE 'Service %'`).all()

const seen = new Set()
const candidates = []
for (const r of [...services, ...byVol, ...byTx]) {
  if (seen.has(r.a)) continue
  seen.add(r.a)
  candidates.push(r)
}
console.log(`candidates: ${candidates.length} (via proxy ${proxyUrl})`)

async function withRetry(url, init = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await uf(url, { ...init, dispatcher, signal: AbortSignal.timeout(30_000) })
      if (r.status === 429 || r.status === 503) { await sleep(6000 * (i + 1)); continue }
      return r
    } catch { await sleep(3000) }
  }
  return null
}

const GAMBLE = /casino|gambl|bet(?!a)|betting|stake|dice|slots?|poker|lottery|lotto|jackpot|roobet|rollbit|bitsler|wager|1xbet|bovada|fortunejack|duelbits|shuffle|gamdom|sportsbook|igaming|bc\.game|metawin|primedice|cloudbet|betfury|thunderpick/i
const EXCHANGE = /binance|okx|okex|huobi|htx|bybit|kraken|coinbase|kucoin|gate\.io|bitfinex|mexc|bitget|crypto\.com|upbit|bithumb|exchange|bitstamp|gemini|bitmart|whitebit|lbank|hotbit|poloniex/i
const NOISE = /^(address|ethereum account|etherscan|contract address|token|0x)/i

const addWatch = db.prepare(`
  INSERT OR IGNORE INTO watchlist(chain, address, label, category, active, created_at)
  VALUES('ETH', ?, ?, ?, 1, ?)`)
const renameService = db.prepare(`UPDATE watchlist SET label=?, category=? WHERE chain='ETH' AND address=? AND label LIKE 'Service %'`)

let found = 0, casinos = 0, checked = 0
for (const c of candidates) {
  checked++
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent('etherscan.io/address/' + c.a)}&output=json&limit=-1&filter=statuscode:200&collapse=digest`
  const cdxRes = await withRetry(cdxUrl)
  if (!cdxRes || !cdxRes.ok) { console.log(`[${checked}/${candidates.length}] ${c.a.slice(0, 10)} cdx-fail`); await sleep(2000); continue }
  let rows
  try { rows = await cdxRes.json() } catch { rows = null }
  if (!rows || rows.length < 2) { await sleep(1500); continue }
  const last = rows[rows.length - 1]
  const ts = last[1], orig = last[2]
  const page = await withRetry(`https://web.archive.org/web/${ts}/${orig}`)
  if (!page || !page.ok) { await sleep(2000); continue }
  const html = await page.text()
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim().replace(/\s+/g, ' ') ?? ''
  const name = title.split('|')[0].trim()
  if (!name || NOISE.test(name) || name.length > 48) { await sleep(1500); continue }
  found++
  const category = GAMBLE.test(name) ? 'casino' : EXCHANGE.test(name) ? 'exchange' : 'other'
  if (category === 'casino') casinos++
  console.log(`[${checked}/${candidates.length}] TAG ${c.a} -> "${name}" (${category}) [snap ${ts.slice(0, 8)}]`)
  const now = Date.now()
  const r = renameService.run(name, category, c.a)
  if (r.changes === 0 && category !== 'other') addWatch.run(c.a, name, category, now)
  else if (r.changes === 0 && category === 'other' && GAMBLE.test(title)) addWatch.run(c.a, name, 'casino', now)
  await sleep(1800)
}
console.log(`done: checked ${checked}, named ${found}, casinos ${casinos}`)
db.close()
