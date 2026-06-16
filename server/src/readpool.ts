import { Worker } from 'node:worker_threads'
import { db } from './db.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Main-thread client for the read-only analytics worker. `workerGet`/`workerAll`
// run a query in the worker (off the event loop) and resolve with the result.
// If the worker is disabled (READ_WORKER!=1) or unavailable (not yet started /
// crashed), they TRANSPARENTLY fall back to running the query on the main thread's
// connection — so behaviour is always correct; the worker is purely an
// offload optimisation. Enabled flag-gated so it can be rolled out / reverted
// without a code change.
// ─────────────────────────────────────────────────────────────────────────────

let worker: Worker | null = null
let ready = false
let nextId = 1
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
const queue: unknown[] = []

export function readWorkerEnabled(): boolean {
  return !!worker
}

export function startReadWorker() {
  if (process.env.READ_WORKER !== '1') {
    console.log('[readworker] disabled (set READ_WORKER=1 to offload heavy reads)')
    return
  }
  spawn()
}

function spawn() {
  try {
    const w = new Worker(new URL('./readworker-boot.mjs', import.meta.url))
    w.on('message', (m: any) => {
      if (m?.ready) {
        ready = true
        for (const q of queue) w.postMessage(q)
        queue.length = 0
        console.log('[readworker] ready — heavy reads offloaded to worker thread')
        return
      }
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error))
    })
    w.on('error', (e) => {
      console.error('[readworker] error — falling back to main thread:', e.message)
      teardown()
    })
    w.on('exit', (code) => {
      if (code !== 0) console.warn(`[readworker] exited (${code}) — falling back to main thread`)
      teardown()
    })
    worker = w
  } catch (e) {
    console.error('[readworker] failed to start — using main thread:', (e as Error).message)
    teardown()
  }
}

function teardown() {
  // reject in-flight requests so callers fall through (they don't, since we settle
  // them; but new calls will hit the main-thread fallback)
  worker = null
  ready = false
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    pending.delete(id)
    p.reject(new Error('worker gone'))
  }
}

function send<T>(sql: string, params: unknown[], method: 'get' | 'all'): Promise<T> {
  // fallback path: no worker → run on the main connection (identical result)
  if (!worker) {
    const stmt = db.prepare(sql)
    return Promise.resolve((method === 'all' ? stmt.all(...params) : stmt.get(...params)) as T)
  }
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        // last-ditch: answer from the main thread rather than fail the request
        try {
          const stmt = db.prepare(sql)
          resolve((method === 'all' ? stmt.all(...params) : stmt.get(...params)) as T)
        } catch (e) {
          reject(e as Error)
        }
      }
    }, 60_000)
    pending.set(id, { resolve, reject, timer })
    const msg = { id, sql, params, method }
    if (ready) worker!.postMessage(msg)
    else queue.push(msg)
  })
}

export function workerGet<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  return send<T>(sql, params, 'get')
}
export function workerAll<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return send<T[]>(sql, params, 'all')
}
