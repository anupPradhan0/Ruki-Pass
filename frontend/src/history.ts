import { useSyncExternalStore } from 'react'

// Session history of cracks / hashes / verifies, kept in localStorage so it
// survives reloads. A tiny external store (useSyncExternalStore) keeps every
// mounted HistoryPanel in sync without prop-drilling or context.

export type HistoryEntry = {
  kind: 'crack' | 'hash' | 'verify'
  algorithm: string | null
  input: string // the hash (crack/verify) or the plaintext (hash)
  output: string // the recovered password (crack/verify) or the hash (hash)
  ts: number
}

const KEY = 'ruki-history'
const MAX = 12

let cache: HistoryEntry[] | null = null
const listeners = new Set<() => void>()

function read(): HistoryEntry[] {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    cache = []
  }
  return cache!
}

function emit() {
  listeners.forEach((l) => l())
}

export function recordHistory(entry: Omit<HistoryEntry, 'ts'>) {
  const next = [{ ...entry, ts: Date.now() }, ...read()]
    // drop older exact duplicates (same kind + input + output), newest wins
    .filter(
      (e, i, arr) =>
        i ===
        arr.findIndex(
          (x) => x.kind === e.kind && x.input === e.input && x.output === e.output,
        ),
    )
    .slice(0, MAX)
  cache = next
  localStorage.setItem(KEY, JSON.stringify(next))
  emit()
}

export function clearHistory() {
  cache = []
  localStorage.removeItem(KEY)
  emit()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, read, () => [])
}
