import { fetch as undiciFetch, ProxyAgent } from 'undici'

// ─────────────────────────────────────────────────────────────────────────────
// Proxy-aware fetch for collectors that talk to the open web (Kick, Google
// News, GitHub label dumps, Reddit, Twitch). Node's global fetch ignores
// HTTP(S)_PROXY env vars, which strands those sources behind corporate
// proxies / in regions where they are only proxy-reachable. Chain RPCs keep
// using global fetch — they are latency-sensitive and reachable directly.
// ─────────────────────────────────────────────────────────────────────────────

const proxyUrl =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy

const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
if (proxyUrl) console.log(`[net] web collectors routing via proxy ${proxyUrl}`)

type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>

export function webFetch(url: string, init: FetchInit = {}) {
  return undiciFetch(url, { ...init, dispatcher })
}
