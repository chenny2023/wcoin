import { ReactNode, useEffect, useRef, useState, MouseEvent, HTMLAttributes } from 'react'
import { useCountUp } from '../data/api'

// ── useInView ───────────────────────────────────────────────────────────────
// Fires once when the element first scrolls into view. Used to trigger reveals
// and count-ups only when the user actually reaches them (not all on page load).
export function useInView<T extends HTMLElement>(opts?: IntersectionObserverInit) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px', ...opts },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])
  return { ref, inView }
}

// ── Reveal ──────────────────────────────────────────────────────────────────
// Wrap any block to make it rise + fade in when scrolled into view. `delay`
// staggers siblings (pass index * 60 for a cascade).
export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'li'
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <Tag ref={ref as never} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  )
}

// ── CountUp ─────────────────────────────────────────────────────────────────
// Animated number that rolls up from 0 the first time it enters view. `format`
// turns the raw number into the display string (e.g. fmtUsd / fmtNum).
export function CountUp({
  value,
  format,
  duration = 1100,
  className = '',
}: {
  value: number
  format?: (n: number) => string
  duration?: number
  className?: string
}) {
  const { ref, inView } = useInView<HTMLSpanElement>()
  const n = useCountUp(inView ? value : 0, duration)
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {format ? format(n) : Math.round(n).toLocaleString()}
    </span>
  )
}

// ── LiveValue ─────────────────────────────────────────────────────────────────
// A number that briefly flashes green when it rises and red when it drops — the
// "live feed" pulse circus.fyi uses. Re-keys on change so the CSS animation
// restarts each time. Use for polled values (volume, viewers, net-flow…).
export function LiveValue({
  value,
  format,
  className = '',
}: {
  value: number
  format: (n: number) => string
  className?: string
}) {
  const prev = useRef(value)
  const [dir, setDir] = useState<'up' | 'down' | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (value !== prev.current) {
      setDir(value > prev.current ? 'up' : 'down')
      setTick((t) => t + 1)
      prev.current = value
    }
  }, [value])
  return (
    <span key={tick} className={`rounded px-1 ${dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : ''} ${className}`}>
      {format(value)}
    </span>
  )
}

// ── spotlight handler ─────────────────────────────────────────────────────────
// Attach to any element carrying the `.spotlight` class to make the glow follow
// the cursor. Returns the onMouseMove prop.
export function useSpotlight() {
  return (e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
}

// ── SpotlightCard ─────────────────────────────────────────────────────────────
// Drop-in card with the cursor-tracking glow + hover lift baked in.
export function SpotlightCard({
  children,
  className = '',
  lift = true,
  ...rest
}: { children: ReactNode; className?: string; lift?: boolean } & HTMLAttributes<HTMLDivElement>) {
  const onMove = useSpotlight()
  return (
    <div onMouseMove={onMove} className={`glass spotlight ${lift ? 'glass-hover' : ''} rounded-2xl ${className}`} {...rest}>
      {children}
    </div>
  )
}
