import { db } from '../db.ts'
import { webFetch } from '../net.ts'
import { sendEmail } from '../email.ts'
import { productByKey } from './products.ts'

// ─────────────────────────────────────────────────────────────────────────────
// C. 黄金一小时提醒：出现高意图机会贴时，立刻通过 Telegram + 邮件提醒团队，
// 以便在帖子热度衰减前抢先回复。
//
// 触发阈值：intent ≥ SOCIAL_ALERT_INTENT（默认 0.7），kind=demand。
// 渠道：
//   - Telegram：配置 TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID（用自己的 bot 推送到群/私聊）
//   - 邮件：发往 SOCIAL_ALERT_EMAIL（默认管理员 chennywang@live.com）
// 去重：social_alert_sent 表，每条机会贴只提醒一次。
// 任一渠道未配置则静默跳过；都没配就只在库里登记不外发。
// ─────────────────────────────────────────────────────────────────────────────

const sent = db.prepare('INSERT OR IGNORE INTO social_alert_sent(signal_id, ts) VALUES(?, ?)')

export interface AlertSignal {
  id: string
  product: string
  platform: string
  kind: string
  title: string
  url: string
  intent: number
}

function threshold(): number {
  const t = Number(process.env.SOCIAL_ALERT_INTENT)
  return Number.isFinite(t) ? t : 0.7
}

async function pushTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_ALERT_CHAT_ID
  if (!token || !chat) return
  try {
    await webFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: false }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    console.warn('[social-intel] telegram alert failed:', (e as Error).message)
  }
}

const esc = (s: string) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

async function notify(s: AlertSignal): Promise<void> {
  const pname = productByKey(s.product)?.name || s.product
  const panel = (process.env.PUBLIC_BASE_URL || 'https://wcoin.casino') + '/internal/social'
  const tg =
    `🔥 <b>高意图机会贴</b> (intent ${s.intent.toFixed(2)})\n` +
    `产品：${esc(pname)} · 平台：${s.platform}\n` +
    `${esc(s.title.slice(0, 200))}\n` +
    `原贴：${esc(s.url)}\n面板：${panel}`
  await pushTelegram(tg)

  const to = process.env.SOCIAL_ALERT_EMAIL || process.env.ADMIN_EMAILS?.split(',')[0]?.trim() || 'chennywang@live.com'
  const html =
    `<p>🔥 <b>高意图机会贴</b>（intent ${s.intent.toFixed(2)}）</p>` +
    `<p>产品：${esc(pname)}　平台：${s.platform}</p>` +
    `<p>${esc(s.title)}</p>` +
    `<p><a href="${esc(s.url)}">查看原贴 →</a>　|　<a href="${esc(panel)}">打开情报面板 →</a></p>`
  const text = `[${pname}] intent ${s.intent.toFixed(2)} — ${s.title}\n${s.url}\n${panel}`
  await sendEmail(to, { subject: `🔥 机会贴 · ${pname} (intent ${s.intent.toFixed(2)})`, html, text })
}

/** 对一批新采集到的信号，挑出高意图 demand 贴去重后提醒。返回实际发出的条数。 */
export async function maybeAlert(signals: AlertSignal[]): Promise<number> {
  const th = threshold()
  const hot = signals.filter((s) => s.kind === 'demand' && (s.intent || 0) >= th)
  let fired = 0
  for (const s of hot) {
    const r = sent.run(s.id, Date.now())
    if (r.changes === 0) continue // already alerted
    await notify(s)
    fired++
  }
  if (fired) console.log(`[social-intel] 🔥 ${fired} high-intent alert(s) sent`)
  return fired
}
