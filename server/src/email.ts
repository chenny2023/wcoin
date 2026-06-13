import { webFetch } from './net.ts'
import { config } from './config.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Transactional email for passwordless sign-in codes. Pluggable + degrades
// gracefully: when RESEND_API_KEY is set we send a real email via the Resend
// HTTP API (no extra dependency — reuses the proxy-aware webFetch); when it is
// unset the code is logged to the server console and reported as undelivered,
// so the whole sign-up flow still works in dev / before email is configured.
// ─────────────────────────────────────────────────────────────────────────────

export function emailEnabled(): boolean {
  return !!config.resendApiKey
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function sendVerificationCode(email: string, code: string): Promise<{ delivered: boolean }> {
  if (!config.resendApiKey) {
    console.log(`[email] RESEND_API_KEY not set — verification code for ${email}: ${code}`)
    return { delivered: false }
  }
  const safeCode = escapeHtml(code)
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b0d12;padding:32px;color:#e8eaf0">
      <div style="max-width:440px;margin:0 auto;background:#11141c;border:1px solid #1e2230;border-radius:16px;padding:32px">
        <div style="font-weight:700;font-size:18px;letter-spacing:.04em;color:#f5b100">WCOIN.CASINO</div>
        <h1 style="font-size:20px;margin:20px 0 6px">Your sign-in code</h1>
        <p style="color:#9aa0b4;font-size:14px;margin:0 0 20px">Enter this code to access your free WCOIN.CASINO account. It expires in 10 minutes.</p>
        <div style="font-size:34px;font-weight:700;letter-spacing:.32em;background:#0b0d12;border:1px solid #1e2230;border-radius:12px;padding:18px;text-align:center;color:#fff">${safeCode}</div>
        <p style="color:#6b7080;font-size:12px;margin:20px 0 0">If you didn't request this, you can safely ignore this email.</p>
      </div>
    </div>`
  const text = `Your WCOIN.CASINO sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this email.`
  try {
    const res = await webFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.resendFrom,
        to: [email],
        subject: `Your WCOIN.CASINO code: ${code}`,
        html,
        text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[email] Resend send failed (${res.status}): ${body.slice(0, 300)}`)
      return { delivered: false }
    }
    return { delivered: true }
  } catch (e) {
    console.error('[email] Resend request error:', (e as Error).message)
    return { delivered: false }
  }
}
