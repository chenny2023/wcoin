import { db } from '../db.ts'
import { generateContent, openrouterEnabled } from '../content/openrouter.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 中文解读：给每条社媒信号生成一句中文解释（讲什么 + 用户需求/意图点），
// 原文 + 中文并排，方便团队跟踪分析。
//
// 后台批量回填：每轮取若干条 zh 为空的信号（高意图优先），一次 LLM 调用翻多条
// （省成本），写回 social_intel.zh。没配 OPENROUTER_API_KEY 时静默不跑。
// 也导出 translateOne() 供「黄金一小时提醒」当场生成中文。
// 所有 DB 访问放在函数内（懒加载），避免与 socialintel.ts 的建表/迁移产生加载顺序问题。
// ─────────────────────────────────────────────────────────────────────────────

const BATCH = Number(process.env.SOCIAL_TRANSLATE_BATCH) || 10

const SYS =
  '你是中文情报分析助手。下面是若干条英文/俄文社媒帖子（来自 Reddit/X/Telegram/论坛）。' +
  '为每条写一句简洁中文解读：这条在讲什么 + 发帖人的需求或意图点（若是竞品讨论，点出对竞品的态度）。' +
  '不要逐字翻译，要"可跟踪分析"的要点。只返回 JSON：{"items":[{"i":序号,"zh":"中文解读"}]}。'

function buildPrompt(rows: { i: number; platform: string; kind: string; title: string; body: string }[]): string {
  return rows
    .map((r) => `[${r.i}] (${r.platform}/${r.kind}) ${r.title}${r.body ? ' — ' + r.body.slice(0, 240) : ''}`)
    .join('\n')
    .slice(0, 8000)
}

/** 取一批未翻译信号（高意图优先），批量生成中文解读写回。返回写回条数。 */
export async function translateBatch(): Promise<number> {
  if (!openrouterEnabled()) return 0
  const rows = db
    .prepare(
      `SELECT id, platform, kind, title, body FROM social_intel
       WHERE zh IS NULL OR zh = ''
       ORDER BY intent DESC, collected_ts DESC LIMIT ?`,
    )
    .all(BATCH) as { id: string; platform: string; kind: string; title: string; body: string }[]
  if (rows.length === 0) return 0

  const indexed = rows.map((r, i) => ({ ...r, i }))
  const res = await generateContent(SYS, buildPrompt(indexed))
  const items = (res?.data?.items ?? []) as { i: number; zh: string }[]
  if (!Array.isArray(items) || items.length === 0) return 0

  const upd = db.prepare('UPDATE social_intel SET zh = ? WHERE id = ?')
  let n = 0
  const tx = db.transaction(() => {
    for (const it of items) {
      const row = indexed[it.i]
      const zh = (it.zh || '').toString().trim().slice(0, 600)
      if (!row || !zh) continue
      upd.run(zh, row.id)
      n++
    }
  })
  tx()
  if (n) console.log(`[social-intel] 中文解读回填 +${n}`)
  return n
}

/** 给单条信号即时生成中文解读（提醒用），并写回。返回 zh 或 null。 */
export async function translateOne(signalId: string): Promise<string | null> {
  if (!openrouterEnabled()) return null
  const r = db.prepare('SELECT id, platform, kind, title, body, zh FROM social_intel WHERE id = ?').get(signalId) as
    | { id: string; platform: string; kind: string; title: string; body: string; zh: string | null }
    | undefined
  if (!r) return null
  if (r.zh) return r.zh
  const res = await generateContent(SYS, buildPrompt([{ i: 0, platform: r.platform, kind: r.kind, title: r.title, body: r.body }]))
  const zh = ((res?.data?.items?.[0]?.zh as string) || '').trim().slice(0, 600)
  if (!zh) return null
  db.prepare('UPDATE social_intel SET zh = ? WHERE id = ?').run(zh, signalId)
  return zh
}

export function startTranslator(): void {
  if ((process.env.SOCIAL_INTEL_ENABLED ?? '1') === '0') return
  if (!openrouterEnabled()) {
    console.log('[social-intel] 中文解读未启用（无 OPENROUTER_API_KEY）')
    return
  }
  console.log('[social-intel] 中文解读后台回填已启动')
  const loop = async () => {
    try {
      await translateBatch()
    } catch (e) {
      console.warn('[social-intel] translate batch failed:', (e as Error).message)
    }
    // 有积压时快一点，翻空了就慢下来；可用 SOCIAL_TRANSLATE_MS 覆盖
    setTimeout(loop, Number(process.env.SOCIAL_TRANSLATE_MS) || 60_000)
  }
  setTimeout(loop, 70_000)
}
