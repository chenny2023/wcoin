import { fetch as undiciFetch, ProxyAgent } from 'undici'

// ─────────────────────────────────────────────────────────────────────────────
// Proxy-aware fetch for collectors that talk to the open web (review sites,
// social, label dumps). Node's global fetch ignores proxy env vars, and many of
// these sources (casino.guru/Cloudflare, archive.org) block datacenter IPs like
// Railway's. Set PROXY_POOL to a comma-separated list of proxy URLs
// (http://user:pass@host:port) and each request is sent through a RANDOM one —
// rotation spreads load so no single IP gets rate-limited/blocked. Falls back to
// a single HTTP(S)_PROXY, or direct. Chain RPCs keep using the global fetch
// (latency-sensitive, reachable directly).
// ─────────────────────────────────────────────────────────────────────────────

const poolRaw =
  process.env.PROXY_POOL ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  ''
const proxyUrls = poolRaw.split(',').map((s) => s.trim()).filter(Boolean)
const agents: ProxyAgent[] = proxyUrls.map((u) => new ProxyAgent(u))
if (agents.length) {
  // never log the URLs — they carry credentials
  console.log(`[net] web collectors routing via ${agents.length} rotating prox${agents.length > 1 ? 'ies' : 'y'}`)
}

function pickAgent(): ProxyAgent | undefined {
  if (agents.length === 0) return undefined
  return agents[Math.floor(Math.random() * agents.length)]
}

type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>

export function webFetch(url: string, init: FetchInit = {}) {
  return undiciFetch(url, { ...init, dispatcher: pickAgent() })
}
