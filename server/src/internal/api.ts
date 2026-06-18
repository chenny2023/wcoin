import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../db.ts'
import { userFromRequest, isAdminEmail } from '../auth.ts'
import { generateDraft } from './drafts.ts'
import { runSocialIntelOnce, runCustomQuery } from './socialintel.ts'
import { PRODUCTS } from './products.ts'
import { PANEL_HTML } from './panel.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 内部社媒情报 — 管理员鉴权 API + 面板。所有数据接口仅 admin 可访问。
// 面板挂在 /internal/social（同源，复用 wcoin_token；也支持内置邮箱验证码登录）。
// ─────────────────────────────────────────────────────────────────────────────

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = userFromRequest(req)
  if (!user || !isAdminEmail(user.email)) {
    reply.code(403).send({ error: 'admin only' })
    return false
  }
  return true
}

export function registerSocialIntel(app: FastifyInstance): void {
  // 面板（HTML 外壳无需鉴权；下面的数据接口才校验 token）
  app.get('/internal/social', async (_req, reply) => {
    return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(PANEL_HTML)
  })

  // 产品/关键词配置（前端渲染过滤器用）
  app.get('/api/internal/social/products', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    return { products: PRODUCTS.map((p) => ({ key: p.key, name: p.name, url: p.url })) }
  })

  // 概览统计
  app.get('/api/internal/social/stats', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const byProduct = db
      .prepare(`SELECT product, kind, COUNT(*) n FROM social_intel GROUP BY product, kind`)
      .all() as { product: string; kind: string; n: number }[]
    const pending = (db.prepare("SELECT COUNT(*) n FROM social_drafts WHERE status='pending'").get() as any).n
    const last24 = (db.prepare('SELECT COUNT(*) n FROM social_intel WHERE collected_ts > ?').get(Date.now() - 86_400_000) as any).n
    const total = (db.prepare('SELECT COUNT(*) n FROM social_intel').get() as any).n
    return { byProduct, pendingDrafts: pending, collected24h: last24, total }
  })

  // 分析概览：跨平台/产品/类别的聚合，供「概览」页可视化
  app.get('/api/internal/social/analytics', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const q = req.query as Record<string, string>
    const days = Math.min(30, Math.max(1, Number(q.days) || 7))
    const since = Date.now() - days * 86_400_000
    const sinceClause = 'collected_ts > ?'
    const byPlatform = db.prepare(`SELECT platform, COUNT(*) n FROM social_intel WHERE ${sinceClause} GROUP BY platform ORDER BY n DESC`).all(since)
    const byKind = db.prepare(`SELECT kind, COUNT(*) n FROM social_intel WHERE ${sinceClause} GROUP BY kind ORDER BY n DESC`).all(since)
    const byProduct = db.prepare(`SELECT product, COUNT(*) n, AVG(sentiment) avg_sent, AVG(intent) avg_intent FROM social_intel WHERE ${sinceClause} GROUP BY product ORDER BY n DESC`).all(since)
    // 情绪三档分布
    const sentiment = db.prepare(`
      SELECT SUM(CASE WHEN sentiment > 0.15 THEN 1 ELSE 0 END) pos,
             SUM(CASE WHEN sentiment < -0.15 THEN 1 ELSE 0 END) neg,
             SUM(CASE WHEN sentiment >= -0.15 AND sentiment <= 0.15 THEN 1 ELSE 0 END) neu
      FROM social_intel WHERE ${sinceClause}`).get(since)
    // 高意图需求关键词排行（机会词）
    const topDemand = db.prepare(`
      SELECT query, COUNT(*) n, AVG(intent) avg_intent, AVG(sentiment) avg_sent
      FROM social_intel WHERE ${sinceClause} AND kind='demand'
      GROUP BY query ORDER BY avg_intent DESC, n DESC LIMIT 15`).all(since)
    // 竞品讨论热度（按命中关键词）
    const topCompetitor = db.prepare(`
      SELECT query, COUNT(*) n, AVG(sentiment) avg_sent
      FROM social_intel WHERE ${sinceClause} AND kind='competitor'
      GROUP BY query ORDER BY n DESC LIMIT 15`).all(since)
    // 按天趋势
    const trend = db.prepare(`
      SELECT strftime('%Y-%m-%d', collected_ts/1000, 'unixepoch') d, COUNT(*) n
      FROM social_intel WHERE ${sinceClause} GROUP BY d ORDER BY d`).all(since)
    // 最高意图的待处理机会贴
    const topOpportunities = db.prepare(`
      SELECT id, product, platform, query, title, url, intent, sentiment, ts
      FROM social_intel WHERE ${sinceClause} AND kind='demand' AND status='new'
      ORDER BY intent DESC, ts DESC LIMIT 10`).all(since)
    return { days, byPlatform, byKind, byProduct, sentiment, topDemand, topCompetitor, trend, topOpportunities }
  })

  // 信号列表（可按产品/类别/平台/最小意图分/状态/关键词过滤）
  app.get('/api/internal/social/signals', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const q = req.query as Record<string, string>
    const where: string[] = []
    const params: any[] = []
    if (q.product) { where.push('product = ?'); params.push(q.product) }
    if (q.kind) { where.push('kind = ?'); params.push(q.kind) }
    if (q.platform) { where.push('platform = ?'); params.push(q.platform) }
    if (q.status) { where.push('status = ?'); params.push(q.status) }
    if (q.minIntent) { where.push('intent >= ?'); params.push(Number(q.minIntent)) }
    if (q.q && q.q.trim()) { where.push('(title LIKE ? OR body LIKE ? OR author LIKE ?)'); const w = `%${q.q.trim()}%`; params.push(w, w, w) }
    const limit = Math.min(200, Number(q.limit) || 60)
    const sort = q.sort === 'intent' ? 'intent DESC, ts DESC' : 'ts DESC'
    const rows = db
      .prepare(`SELECT * FROM social_intel ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sort} LIMIT ?`)
      .all(...params, limit)
    return { signals: rows }
  })

  // 为某条信号生成推荐草稿
  app.post('/api/internal/social/draft', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const b = req.body as { signalId?: string }
    if (!b?.signalId) return reply.code(400).send({ error: 'signalId required' })
    return await generateDraft(b.signalId)
  })

  // 草稿队列（连带原贴信息）
  app.get('/api/internal/social/drafts', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const q = req.query as Record<string, string>
    const status = q.status || 'pending'
    const rows = db
      .prepare(
        `SELECT d.*, s.title AS post_title, s.url AS post_url, s.platform, s.kind, s.author, s.intent
         FROM social_drafts d JOIN social_intel s ON s.id = d.signal_id
         WHERE d.status = ? ORDER BY d.created_ts DESC LIMIT 100`,
      )
      .all(status)
    return { drafts: rows }
  })

  // 更新草稿状态：approved | posted | dismissed | pending
  app.post('/api/internal/social/draft/:id/status', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const id = Number((req.params as any).id)
    const b = req.body as { status?: string; draft?: string }
    const allowed = ['pending', 'approved', 'posted', 'dismissed']
    if (!b?.status || !allowed.includes(b.status)) return reply.code(400).send({ error: 'invalid status' })
    // 允许审核时同时改写草稿正文
    if (typeof b.draft === 'string') {
      db.prepare('UPDATE social_drafts SET status=?, draft=?, updated_ts=? WHERE id=?').run(b.status, b.draft, Date.now(), id)
    } else {
      db.prepare('UPDATE social_drafts SET status=?, updated_ts=? WHERE id=?').run(b.status, Date.now(), id)
    }
    return { ok: true }
  })

  // 标记信号状态（忽略/已读）
  app.post('/api/internal/social/signal/:id/status', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const id = (req.params as any).id as string
    const b = req.body as { status?: string }
    const allowed = ['new', 'reviewed', 'ignored']
    if (!b?.status || !allowed.includes(b.status)) return reply.code(400).send({ error: 'invalid status' })
    db.prepare('UPDATE social_intel SET status=? WHERE id=?').run(b.status, id)
    return { ok: true }
  })

  // 手动触发一轮采集（管理员调试用）
  app.post('/api/internal/social/run', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    void runSocialIntelOnce()
    return { ok: true, message: '已触发一轮采集（异步）' }
  })

  // ── 自定义采集需求 ───────────────────────────────────────────────────────
  // 立即采集一条自定义查询；save=true 时同时保存为可定时轮询的需求。
  app.post('/api/internal/social/custom', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const b = (req.body || {}) as {
      label?: string; product?: string; platform?: string; kind?: string
      query?: string; subreddits?: string; save?: boolean
    }
    const query = String(b.query || '').trim()
    if (query.length < 2) return reply.code(400).send({ error: 'query 至少 2 个字符' })
    const platform = b.platform === 'x' ? 'x' : 'reddit'
    const kind = ['brand', 'competitor', 'demand'].includes(String(b.kind)) ? String(b.kind) : 'demand'
    const product = (String(b.product || 'custom').trim() || 'custom').slice(0, 40)
    const subreddits = String(b.subreddits || '').split(',').map((s) => s.trim()).filter(Boolean)

    let savedId: number | undefined
    if (b.save) {
      const info = db
        .prepare(
          `INSERT INTO social_custom_query(label, product, platform, kind, query, subreddits, active, created_ts)
           VALUES(?,?,?,?,?,?,1,?)`,
        )
        .run(String(b.label || query).slice(0, 120), product, platform, kind, query, subreddits.join(','), Date.now())
      savedId = Number(info.lastInsertRowid)
    }
    let added = 0
    let error: string | undefined
    try {
      added = await runCustomQuery({ product, platform, kind, query, subreddits })
    } catch (e) {
      error = (e as Error).message
    }
    if (savedId) db.prepare('UPDATE social_custom_query SET last_run_ts=? WHERE id=?').run(Date.now(), savedId)
    return { ok: !error, added, savedId, error }
  })

  // 已保存的自定义需求列表
  app.get('/api/internal/social/custom', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const items = db.prepare('SELECT * FROM social_custom_query ORDER BY created_ts DESC LIMIT 200').all()
    return { items }
  })

  // 启用/停用一条已保存需求
  app.post('/api/internal/social/custom/:id/toggle', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const id = Number((req.params as any).id)
    db.prepare('UPDATE social_custom_query SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(id)
    return { ok: true }
  })

  // 立即重跑一条已保存需求
  app.post('/api/internal/social/custom/:id/run', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const id = Number((req.params as any).id)
    const row = db.prepare('SELECT * FROM social_custom_query WHERE id=?').get(id) as any
    if (!row) return reply.code(404).send({ error: 'not found' })
    let added = 0
    let error: string | undefined
    try {
      added = await runCustomQuery({
        product: row.product, platform: row.platform, kind: row.kind,
        query: row.query, subreddits: String(row.subreddits || '').split(',').map((s: string) => s.trim()).filter(Boolean),
      })
    } catch (e) { error = (e as Error).message }
    db.prepare('UPDATE social_custom_query SET last_run_ts=? WHERE id=?').run(Date.now(), id)
    return { ok: !error, added, error }
  })

  // 删除一条已保存需求
  app.delete('/api/internal/social/custom/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    db.prepare('DELETE FROM social_custom_query WHERE id=?').run(Number((req.params as any).id))
    return { ok: true }
  })

  console.log('[social-intel] internal panel registered at /internal/social')
}
