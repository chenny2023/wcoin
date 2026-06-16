import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, Trash2, Search, Plus, Loader2, ShieldCheck } from 'lucide-react'
import { Card, PageHead, ChainPill, TrustBadge, Skeleton, EmptyState } from '../components/ui'
import { api, usePoll, getToken } from '../data/api'
import { fmtUsd } from '../data/format'

// Personal watchlist — each signed-in user's own list of followed casinos, with
// live on-chain stats. (Distinct from the operator-curated global tracked-address
// set, which is managed server-side.)
export default function Watchlist() {
  const loggedIn = !!getToken()
  const [version, setVersion] = useState(0)
  const { data, loading } = usePoll(api.myWatchlist, 8_000, [version])
  const { data: brands } = usePoll(() => api.brands('casino'), 60_000)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const items = data?.items ?? []
  const favLabels = new Set(items.map((i) => i.label.toLowerCase()))
  const reload = () => setVersion((v) => v + 1)

  const matches =
    q.trim().length >= 1
      ? (brands ?? [])
          .filter((b) => b.brand.toLowerCase().includes(q.trim().toLowerCase()) && !favLabels.has(b.brand.toLowerCase()))
          .slice(0, 8)
      : []

  async function add(label: string) {
    setBusy(label)
    try {
      await api.addFavorite(label)
      setQ('')
      reload()
    } finally {
      setBusy(null)
    }
  }
  async function remove(key: string) {
    setBusy(key)
    try {
      await api.removeFavorite(key)
      reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fade-up">
      <PageHead title="My Watchlist" subtitle="Casinos you follow — live on-chain volume, reserves and trust, in one place" />

      {!loggedIn ? (
        <Card className="p-8 text-center">
          <Star size={26} className="mx-auto mb-3 text-gold-400" />
          <div className="font-display text-lg font-semibold">Sign in to build your watchlist</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-white/50">Follow the casinos you care about and track their on-chain volume, reserves and trust at a glance.</p>
          <Link to="/login" className="mt-4 inline-block rounded-xl bg-gradient-to-r from-gold-400 to-gold-600 px-6 py-2.5 text-sm font-semibold text-ink-950 hover:brightness-110">Sign in free</Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Add box */}
          <Card className="p-5 lg:col-span-1">
            <div className="mb-3 flex items-center gap-2">
              <Plus size={18} className="text-gold-400" />
              <h3 className="font-display text-lg font-semibold">Follow a casino</h3>
            </div>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search casinos…"
                className="w-full rounded-xl border border-white/10 bg-white/4 py-2.5 pl-9 pr-3 text-sm placeholder:text-white/30 focus:border-gold-500/40 focus:outline-none"
              />
            </div>
            {matches.length > 0 && (
              <div className="mt-2 divide-y divide-white/6 overflow-hidden rounded-xl border border-white/8">
                {matches.map((b) => (
                  <button
                    key={b.brand}
                    onClick={() => add(b.brand)}
                    disabled={busy === b.brand}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-white/[0.04] disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{b.brand}</span>
                      <ChainPill chain={b.chains[0] ?? 'ETH'} />
                    </span>
                    {busy === b.brand ? <Loader2 size={14} className="animate-spin text-white/40" /> : <Plus size={14} className="text-gold-400" />}
                  </button>
                ))}
              </div>
            )}
            {q.trim() && matches.length === 0 && <p className="mt-2 text-[13px] text-white/40">No matching casinos (or already followed).</p>}
            <p className="mt-3 text-[12px] leading-snug text-white/40">Your watchlist is private to your account. Stats update automatically from live on-chain data.</p>
          </Card>

          {/* Followed list */}
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 font-display text-lg font-semibold">Following ({items.length})</h3>
            {loading && !data ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : items.length === 0 ? (
              <EmptyState title="No casinos followed yet" hint="Search on the left to follow a casino and track it here." />
            ) : (
              <div className="divide-y divide-white/6">
                {items.map((it) => (
                  <div key={it.brandKey} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{it.label}</span>
                        {it.stats?.chains?.[0] && <ChainPill chain={it.stats.chains[0]} />}
                        {it.stats && it.stats.chains.length > 1 && <span className="text-[10px] text-white/35">+{it.stats.chains.length - 1}</span>}
                      </div>
                      {it.stats ? (
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-white/50">
                          <span>7d vol <span className="font-semibold tabular-nums text-white/75">{fmtUsd(it.stats.volume7d)}</span></span>
                          <span className="inline-flex items-center gap-1"><ShieldCheck size={11} className="text-mint-400" />{fmtUsd(it.stats.reserves)}</span>
                          <span>net <span className={`tabular-nums ${it.stats.net7d >= 0 ? 'text-mint-400' : 'text-rose-400'}`}>{it.stats.net7d >= 0 ? '+' : '−'}{fmtUsd(Math.abs(it.stats.net7d))}</span></span>
                          {it.stats.safetyIndex != null && <span className="text-white/40">guru {it.stats.safetyIndex.toFixed(1)}</span>}
                        </div>
                      ) : (
                        <div className="mt-1 text-[12px] text-white/35">Awaiting on-chain data for this operator</div>
                      )}
                    </div>
                    {it.stats && <TrustBadge score={it.stats.trust} />}
                    <button
                      onClick={() => remove(it.brandKey)}
                      disabled={busy === it.brandKey}
                      className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/50 hover:bg-rose-400/15 hover:text-rose-400 disabled:opacity-50"
                      title="Unfollow"
                    >
                      {busy === it.brandKey ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
