import { FastifyInstance } from 'fastify'
import { randomInt, randomBytes } from 'node:crypto'
import { db } from './db.ts'
import { sendEmail, subscribeConfirmBody } from './email.ts'
import { config } from './config.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Daily-digest email subscription (double opt-in). Reuses the existing
// verification_codes table + the email transports. No login/session — a subscriber
// just confirms their email via a code, then manages via a non-enumerable
// unsubscribe token. Frequency (daily|weekly) is inline on the subscriber row.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const CODE_TTL_MS = 10 * 60_000
const MAX_CODES_PER_WINDOW = 5
const MAX_VERIFY_ATTEMPTS = 5

export function registerSubscribe(app: FastifyInstance) {
  // step 1 — request a confirmation code
  app.post('/api/subscribe', async (req, reply) => {
    const email = (req.body as { email?: string })?.email?.trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'A valid email is required' })
    const now = Date.now()
    const existing = db.prepare('SELECT status FROM email_subscriber WHERE email=?').get(email) as { status: string } | undefined
    if (existing?.status === 'active') return { sent: false, alreadyActive: true }
    // anti-bombing: cap codes per email per window (shared with sign-in)
    const recent = (db.prepare('SELECT COUNT(*) n FROM verification_codes WHERE email=? AND created_at > ?').get(email, now - CODE_TTL_MS) as any).n
    if (recent >= MAX_CODES_PER_WINDOW) return reply.code(429).send({ error: 'Too many requests — try again later' })

    db.prepare(
      `INSERT INTO email_subscriber(email, status, frequency, unsubscribe_token, created_at, updated_at)
       VALUES(?, 'pending', 'daily', ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET status='pending', updated_at=excluded.updated_at`,
    ).run(email, randomBytes(24).toString('hex'), now, now)

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    db.prepare('INSERT INTO verification_codes(email, code, expires_at, attempts, created_at) VALUES(?, ?, ?, 0, ?)').run(email, code, now + CODE_TTL_MS, now)
    const { delivered } = await sendEmail(email, subscribeConfirmBody(code))
    const devCode = !delivered && config.nodeEnv !== 'production' ? code : undefined
    return { sent: true, delivered, ...(devCode ? { devCode } : {}) }
  })

  // step 2 — confirm the code → activate the subscriber
  app.post('/api/subscribe/verify', async (req, reply) => {
    const b = req.body as { email?: string; code?: string }
    const email = b?.email?.trim().toLowerCase()
    const code = b?.code?.trim()
    if (!email || !EMAIL_RE.test(email) || !code) return reply.code(400).send({ error: 'Email and code are required' })
    const row = db
      .prepare('SELECT rowid, code, expires_at, attempts FROM verification_codes WHERE email=? ORDER BY created_at DESC LIMIT 1')
      .get(email) as { rowid: number; code: string; expires_at: number; attempts: number } | undefined
    if (!row) return reply.code(400).send({ error: 'Request a code first' })
    if (row.expires_at < Date.now()) {
      db.prepare('DELETE FROM verification_codes WHERE email=?').run(email)
      return reply.code(400).send({ error: 'Code expired — request a new one' })
    }
    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      db.prepare('DELETE FROM verification_codes WHERE email=?').run(email)
      return reply.code(429).send({ error: 'Too many attempts. Request a new code.' })
    }
    if (row.code !== code) {
      db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE rowid = ?').run(row.rowid)
      return reply.code(400).send({ error: 'Invalid code' })
    }
    db.prepare('DELETE FROM verification_codes WHERE email=?').run(email)
    const now = Date.now()
    db.prepare("UPDATE email_subscriber SET status='active', verified_at=?, updated_at=? WHERE email=?").run(now, now, email)
    const tok = (db.prepare('SELECT unsubscribe_token, frequency FROM email_subscriber WHERE email=?').get(email) as any) ?? {}
    return { active: true, unsubscribeToken: tok.unsubscribe_token, frequency: tok.frequency }
  })

  // one-click unsubscribe (token in every email; no login; non-enumerable)
  app.get('/api/unsubscribe', async (req, reply) => {
    const token = (req.query as { token?: string })?.token
    if (token) db.prepare("UPDATE email_subscriber SET status='unsubscribed', updated_at=? WHERE unsubscribe_token=?").run(Date.now(), token)
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed — WCOIN.CASINO</title>` +
          `<body style="font-family:-apple-system,system-ui,sans-serif;background:#0b0d12;color:#e8eaf0;display:grid;place-items:center;min-height:100vh;margin:0">` +
          `<div style="text-align:center;padding:24px"><div style="font-weight:700;color:#f5b100;letter-spacing:.04em">WCOIN.CASINO</div>` +
          `<h1 style="font-size:22px;margin:16px 0 6px">You're unsubscribed</h1>` +
          `<p style="color:#9aa0b4">You won't receive the WCOIN Daily anymore.<br><a href="https://wcoin.casino" style="color:#f5b100">← Back to WCOIN.CASINO</a></p></div></body>`,
      )
  })

  // change frequency / re-subscribe via the token (no login)
  app.post('/api/subscribe/preferences', async (req, reply) => {
    const b = req.body as { token?: string; frequency?: string }
    if (!b?.token) return reply.code(400).send({ error: 'token required' })
    const freq = b.frequency === 'weekly' ? 'weekly' : 'daily'
    const r = db
      .prepare("UPDATE email_subscriber SET frequency=?, status=CASE WHEN status='unsubscribed' THEN 'active' ELSE status END, updated_at=? WHERE unsubscribe_token=?")
      .run(freq, Date.now(), b.token)
    if (!r.changes) return reply.code(404).send({ error: 'unknown token' })
    return { ok: true, frequency: freq }
  })
}
