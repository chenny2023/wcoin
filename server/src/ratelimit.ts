import { FastifyInstance } from 'fastify'

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight in-memory per-IP rate limiter (single-process, behind Cloudflare).
// Defense-in-depth on top of CF's edge protection: caps abusive direct/origin
// traffic without a new dependency. Keyed on the REAL client IP (cf-connecting-ip)
// so every visitor gets their own budget rather than sharing the CF edge IP.
// Limits are generous — a normal (polling, hidden-tab-paused) dashboard tab does
// ~15-25 req/min, far under the general budget; only scrapers/abuse hit the cap.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = 60_000
const GENERAL = Number(process.env.RATE_LIMIT_PER_MIN ?? 300)
const TIGHT = Number(process.env.RATE_LIMIT_TIGHT_PER_MIN ?? 40)
// expensive / less-cached endpoints get a stricter budget
const TIGHT_RE = /^\/api\/(search|transfers|entity\/\d+\/flow)\b/

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const cf = req.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf) return cf
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim()
  return req.ip || 'unknown'
}

export function registerRateLimit(app: FastifyInstance) {
  if (process.env.RATE_LIMIT === '0') {
    console.log('[ratelimit] disabled (RATE_LIMIT=0)')
    return
  }
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return // CORS preflight — never limit
    const path = req.url.split('?')[0]
    if (!path.startsWith('/api/') || path === '/api/health') return // SPA + healthcheck exempt
    const tight = TIGHT_RE.test(path)
    const max = tight ? TIGHT : GENERAL
    const key = clientIp(req as any) + (tight ? '|t' : '|g')
    const now = Date.now()
    let b = buckets.get(key)
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + WINDOW_MS }
      buckets.set(key, b)
    }
    b.count++
    if (b.count > max) {
      const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000))
      return reply
        .header('Retry-After', String(retry))
        .header('Cache-Control', 'no-store')
        .code(429)
        .send({ error: 'rate limit exceeded — slow down' })
    }
  })
  // evict expired buckets so the map can't grow unbounded
  setInterval(() => {
    const now = Date.now()
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
  }, 120_000).unref?.()
  console.log(`[ratelimit] active (${GENERAL}/min general, ${TIGHT}/min tight, per client IP)`)
}
