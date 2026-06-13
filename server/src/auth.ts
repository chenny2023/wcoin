import { FastifyInstance, FastifyRequest } from 'fastify'
import { randomBytes, randomInt } from 'node:crypto'
import { db } from './db.ts'
import { config } from './config.ts'
import { sendVerificationCode } from './email.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Passwordless authentication. The product is 100% free: anyone signs up with
// just an email + a 6-digit verification code (no password, no payment). A code
// is emailed (Resend) — or logged to the console when email isn't configured —
// then exchanged for a 30-day opaque session token. First user becomes admin.
// Community trust votes are tied to authenticated users (one vote per entity).
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_DAYS = 30
const CODE_TTL_MS = 10 * 60_000 // codes expire in 10 minutes
const MAX_CODES_PER_WINDOW = 5 // max codes requested per email per TTL window
const MAX_VERIFY_ATTEMPTS = 5 // wrong-code guesses before a code is burned

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface AuthUser {
  id: number
  email: string
  role: string
}

export function userFromRequest(req: FastifyRequest): AuthUser | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now()) as AuthUser | undefined
  return row ?? null
}

function issueSession(userId: number): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)').run(
    token,
    userId,
    now,
    now + SESSION_DAYS * 86_400_000,
  )
  return token
}

// Find an existing account by email or create one (passwordless — no hash).
// The first account ever created becomes the admin. The count-then-insert runs
// inside a transaction so the "first user → admin" decision is atomic.
const findOrCreateTx = db.transaction((email: string): AuthUser => {
  const existing = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email) as
    | AuthUser
    | undefined
  if (existing) return existing
  const isFirst = (db.prepare('SELECT COUNT(*) n FROM users').get() as any).n === 0
  const role = isFirst ? 'admin' : 'casino'
  const info = db
    .prepare('INSERT INTO users(email, pass_hash, salt, role, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(email, '', '', role, Date.now())
  return { id: Number(info.lastInsertRowid), email, role }
})

function findOrCreateUser(email: string): AuthUser {
  return findOrCreateTx(email)
}

export async function registerAuth(app: FastifyInstance) {
  // ── step 1: request a sign-in code ─────────────────────────────────────────
  app.post('/api/auth/request-code', async (req, reply) => {
    const b = req.body as { email?: string }
    const email = b?.email?.trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'A valid email is required' })
    }
    const now = Date.now()
    // rate-limit: cap codes per email within one TTL window (anti-bombing)
    const recent = (
      db
        .prepare('SELECT COUNT(*) n FROM verification_codes WHERE email = ? AND created_at > ?')
        .get(email, now - CODE_TTL_MS) as any
    ).n
    if (recent >= MAX_CODES_PER_WINDOW) {
      return reply.code(429).send({ error: 'Too many codes requested. Please wait a few minutes and try again.' })
    }
    // mint a fresh code. Prior codes are left in place so the per-window count
    // above can actually rate-limit (deleting them here would reset it to 0);
    // verify() only ever honours the most recent row, and all rows are purged
    // on success or by the hourly expiry sweep.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    db.prepare(
      'INSERT INTO verification_codes(email, code, expires_at, attempts, created_at) VALUES(?, ?, ?, 0, ?)',
    ).run(email, code, now + CODE_TTL_MS, now)

    const { delivered } = await sendVerificationCode(email, code)
    // Only ever reveal the code to the client outside production (so the flow is
    // testable before email is wired up). In production an unconfigured mailer
    // means the code lives only in the server logs — never the HTTP response.
    const devCode = !delivered && config.nodeEnv !== 'production' ? code : undefined
    return { sent: true, delivered, ...(devCode ? { devCode } : {}) }
  })

  // ── step 2: verify the code → issue a session ──────────────────────────────
  app.post('/api/auth/verify', async (req, reply) => {
    const b = req.body as { email?: string; code?: string }
    const email = b?.email?.trim().toLowerCase()
    const code = b?.code?.trim()
    if (!email || !EMAIL_RE.test(email) || !code) {
      return reply.code(400).send({ error: 'Email and code are required' })
    }
    const row = db
      .prepare(
        'SELECT rowid, code, expires_at, attempts FROM verification_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(email) as { rowid: number; code: string; expires_at: number; attempts: number } | undefined
    if (!row || row.expires_at < Date.now()) {
      return reply.code(401).send({ error: 'Code expired or not found. Request a new one.' })
    }
    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      db.prepare('DELETE FROM verification_codes WHERE email = ?').run(email)
      return reply.code(429).send({ error: 'Too many attempts. Request a new code.' })
    }
    if (row.code !== code) {
      db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE rowid = ?').run(row.rowid)
      return reply.code(401).send({ error: 'Invalid code' })
    }
    // success — burn the code(s) and issue a session
    db.prepare('DELETE FROM verification_codes WHERE email = ?').run(email)
    const user = findOrCreateUser(email)
    const token = issueSession(user.id)
    return { token, user }
  })

  app.get('/api/auth/me', async (req, reply) => {
    const user = userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'not authenticated' })
    return { user }
  })

  app.post('/api/auth/logout', async (req) => {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.slice(7).trim())
    }
    return { ok: true }
  })

  // ── community trust votes (authenticated, one per user per entity) ──────────
  app.post('/api/vote', async (req, reply) => {
    const user = userFromRequest(req)
    if (!user) return reply.code(401).send({ error: 'login required to vote' })
    const b = req.body as { watch_id?: number; vote?: number }
    const watchId = Number(b?.watch_id)
    const vote = Number(b?.vote)
    if (!watchId || (vote !== 1 && vote !== -1)) {
      return reply.code(400).send({ error: 'watch_id and vote (+1 | -1) required' })
    }
    const entity = db.prepare('SELECT id FROM watchlist WHERE id = ? AND active = 1').get(watchId)
    if (!entity) return reply.code(404).send({ error: 'unknown entity' })
    db.prepare(
      `INSERT INTO votes(user_id, watch_id, vote, updated_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(user_id, watch_id) DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at`,
    ).run(user.id, watchId, vote, Date.now())
    return { ok: true }
  })

  // periodic cleanup of expired sessions + verification codes
  setInterval(() => {
    const now = Date.now()
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
    db.prepare('DELETE FROM verification_codes WHERE expires_at < ?').run(now)
  }, 3600_000)
}
