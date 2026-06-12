// ─────────────────────────────────────────────────────────────────────────────
// Shared lexicon sentiment scorer for casino/gambling community text. A small
// VADER-style model: weighted polarity words, negation flipping, intensifier
// boosting, and ALL-CAPS / exclamation amplification. Returns a score in
// [-1, 1]. Zero external dependencies. Used by every text collector (news,
// press, telegram) so scoring is consistent and improves in one place.
// ─────────────────────────────────────────────────────────────────────────────

// word → polarity weight (gambling-community tuned)
const LEX: Record<string, number> = {
  // positive
  win: 1.5, won: 1.5, winning: 1.4, paid: 1.6, payout: 1.5, fast: 1.0, legit: 1.8, great: 1.4,
  good: 1.0, best: 1.6, love: 1.6, profit: 1.4, bonus: 0.8, instant: 1.2, trust: 1.5, trusted: 1.7,
  recommend: 1.5, awesome: 1.7, fair: 1.3, smooth: 1.1, reliable: 1.5, generous: 1.4, huge: 1.0,
  growth: 0.9, record: 0.8, launch: 0.5, partnership: 0.6, verified: 1.2, safe: 1.4, quick: 1.0,
  // negative
  scam: -2.2, scammed: -2.2, rigged: -2.3, lost: -1.0, lose: -1.0, losing: -1.0, stole: -2.2,
  stolen: -2.2, fraud: -2.3, banned: -1.6, locked: -1.5, withhold: -1.7, refuse: -1.7, refused: -1.8,
  delay: -1.2, delayed: -1.3, avoid: -1.8, worst: -2.0, bad: -1.2, terrible: -1.9, lawsuit: -1.6,
  fine: -1.0, fined: -1.4, hack: -1.8, hacked: -2.0, breach: -1.7, investigation: -1.3, illegal: -1.8,
  laundering: -1.9, predatory: -1.8, rip: -1.6, ripped: -1.8, ignored: -1.4, broken: -1.3, shady: -1.7,
}
const NEGATORS = new Set(['not', 'no', 'never', "n't", 'without', 'cant', "can't", 'dont', "don't", 'wont', "won't", 'hardly', 'barely'])
const INTENSIFIERS: Record<string, number> = { very: 1.4, really: 1.4, extremely: 1.7, so: 1.3, super: 1.4, totally: 1.3, absolutely: 1.6, completely: 1.4, highly: 1.4 }

export function score(text: string): number {
  if (!text) return 0
  const raw = text.slice(0, 4000)
  const words = raw.toLowerCase().split(/[^a-z']+/).filter(Boolean)
  let sum = 0
  let hits = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const base = LEX[w]
    if (base === undefined) continue
    let val = base
    // look back up to 2 words for negation / intensifier
    for (let j = Math.max(0, i - 2); j < i; j++) {
      if (NEGATORS.has(words[j])) val *= -0.75
      else if (INTENSIFIERS[words[j]]) val *= INTENSIFIERS[words[j]]
    }
    sum += val
    hits++
  }
  if (hits === 0) return 0
  // amplify for shouting / exclamation, then squash to [-1,1]
  let s = sum / Math.sqrt(hits * 2 + 1) // normalize by sample size (VADER-like)
  const caps = (raw.match(/\b[A-Z]{3,}\b/g) || []).length
  const bangs = (raw.match(/!/g) || []).length
  s *= 1 + Math.min(0.4, (caps + bangs) * 0.05)
  return Math.max(-1, Math.min(1, s / 2.5))
}

export const isPositive = (s: number) => s > 0.15
export const isNegative = (s: number) => s < -0.15
