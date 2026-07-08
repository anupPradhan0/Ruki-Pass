// Talks to the Ruki-Pass FastAPI backend.
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

// A copy-pasteable curl for any POST endpoint — lets a user reproduce the exact
// API call from a terminal. Single-quoted body; JSON has no single quotes so
// this stays valid for our payloads.
export function toCurl(path: string, body: unknown): string {
  return `curl -X POST ${API_BASE}${path} \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(body)}'`
}

// ---- AI assistant (Gemini / Gemma) ----
export type AssistStatus = { available: boolean; model: string }

export type TranscriptMessage = { role: 'assistant' | 'user' | 'system'; text: string }

export type AssistResponse = {
  status: 'need_input' | 'solved' | 'gave_up' | 'exhausted'
  thought: string
  questions: string[]
  password: string | null
  attempts: number | null
  strategy_note: string | null
  reason: string | null
  transcript: TranscriptMessage[]
}

export async function getAssistStatus(): Promise<AssistStatus> {
  const res = await fetch(`${API_BASE}/api/assist/status`)
  if (!res.ok) throw new Error(`status ${res.status}`)
  return res.json()
}

export async function assist(
  hash: string,
  algorithm: string,
  transcript: TranscriptMessage[],
  opts: {
    salt?: string | null
    iterations?: number | null
    prf?: string
    // Form facts the user already entered, so the AI won't re-ask them.
    extraWords?: string[]
    length?: number | null
    special?: string
    specialChars?: string[]
  } = {},
): Promise<AssistResponse> {
  const res = await fetch(`${API_BASE}/api/assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hash: hash.trim(),
      algorithm,
      transcript,
      salt: opts.salt ?? null,
      iterations: opts.iterations ?? null,
      prf: opts.prf ?? 'sha256',
      extra_words: opts.extraWords ?? [],
      length: opts.length ?? null,
      special: opts.special ?? 'unknown',
      special_chars: opts.specialChars ?? [],
    }),
  })
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* keep generic message */
    }
    throw new Error(detail)
  }
  return res.json()
}

export type CrackResponse = {
  found: boolean
  hash: string
  algorithm: string | null
  password: string | null
  attempts: number
  duration_ms: number
  wordlist_exhausted: boolean
  wordlist: string | null
}

export type HashResponse = { algorithm: string; hash: string; saved: boolean }

export type VerifyResponse = { match: boolean; algorithm: string | null }

// Check a single plaintext guess against a hash — instant, no wordlist search.
export async function verifyHash(
  hash: string,
  candidate: string,
  opts: {
    algorithm?: string
    salt?: string | null
    iterations?: number | null
    prf?: string
    hashMode?: HashMode
  } = {},
): Promise<VerifyResponse> {
  const res = await fetch(`${API_BASE}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hash: hash.trim(),
      candidate,
      algorithm: opts.algorithm,
      salt: opts.salt ?? null,
      iterations: opts.iterations ?? null,
      prf: opts.prf ?? 'sha256',
      hash_mode: opts.hashMode ?? 'plain',
    }),
  })
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* keep generic message */
    }
    throw new Error(detail)
  }
  return res.json()
}

// Algorithms the generator can produce (mirrors backend HASHABLE_ALGORITHMS).
export const HASHABLE = [
  'md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'bcrypt', 'pbkdf2',
] as const

type HashOpts = { salt?: string | null; hashMode?: HashMode }

function hashBody(text: string, algorithm: string, save: boolean, opts: HashOpts = {}) {
  return {
    text,
    algorithm,
    save,
    salt: opts.salt ?? null,
    hash_mode: opts.hashMode ?? 'plain',
  }
}

export function curlForHash(
  text: string,
  algorithm: string,
  save: boolean,
  opts: HashOpts = {},
): string {
  return toCurl('/api/hash', hashBody(text, algorithm, save, opts))
}

export async function hashText(
  text: string,
  algorithm: string,
  save: boolean,
  opts: HashOpts = {},
): Promise<HashResponse> {
  const res = await fetch(`${API_BASE}/api/hash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hashBody(text, algorithm, save, opts)),
  })
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* keep generic message */
    }
    throw new Error(detail)
  }
  return res.json()
}

export type Special = 'unknown' | 'yes' | 'no'

export const SPECIAL_OPTIONS = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'no', label: 'No (none)' },
  { value: 'yes', label: 'Yes (has one)' },
] as const

export type CrackOptions = {
  algorithm?: string
  useRules?: boolean
  extraWords?: string[]
  bruteForce?: boolean
  bruteMaxDigits?: number
  length?: number | null
  special?: Special
  bruteAround?: boolean
  specialChars?: string[]
  // An uploaded wordlist, tried early.
  customWords?: string[]
  // Salt/HMAC scheme for plain hashes.
  hashMode?: HashMode
  // PBKDF2 salt (or the salt/key for a salted plain hash).
  salt?: string | null
  iterations?: number | null
  prf?: string
}

export type HashMode = 'plain' | 'prefix' | 'suffix' | 'hmac'

export const HASH_MODE_OPTIONS = [
  { value: 'plain', label: 'None — H(password)' },
  { value: 'prefix', label: 'Salt + password' },
  { value: 'suffix', label: 'Password + salt' },
  { value: 'hmac', label: 'HMAC(salt, password)' },
] as const

export type Progress = { attempts: number; rate: number }

function crackBody(hash: string, options: CrackOptions = {}) {
  const {
    algorithm,
    useRules = true,
    extraWords = [],
    bruteForce = false,
    bruteMaxDigits = 5,
    length = null,
    special = 'unknown',
    bruteAround = false,
    specialChars = [],
    customWords = [],
    hashMode = 'plain',
    salt = null,
    iterations = null,
    prf = 'sha256',
  } = options
  return {
    hash: hash.trim(),
    algorithm,
    use_rules: useRules,
    extra_words: extraWords,
    brute_force: bruteForce,
    brute_max_digits: bruteMaxDigits,
    length: length ?? null,
    special,
    brute_around: bruteAround,
    special_chars: specialChars,
    custom_words: customWords,
    hash_mode: hashMode,
    salt: salt ?? null,
    iterations: iterations ?? null,
    prf,
  }
}

export function curlForCrack(hash: string, options: CrackOptions = {}): string {
  return toCurl('/api/crack', crackBody(hash, options))
}

// Streaming crack: reads Server-Sent Events, calls onProgress as candidates are
// checked, and resolves with the final result. Falls back cleanly if the body
// isn't streamable.
export async function crackHashStream(
  hash: string,
  options: CrackOptions,
  onProgress?: (p: Progress) => void,
): Promise<CrackResponse> {
  const res = await fetch(`${API_BASE}/api/crack/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(crackBody(hash, options)),
  })
  if (!res.ok || !res.body) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* keep generic message */
    }
    throw new Error(detail)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let final: CrackResponse | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // SSE events are separated by a blank line.
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const ev = JSON.parse(line.slice(5).trim())
      if (ev.type === 'progress') {
        onProgress?.({ attempts: ev.attempts, rate: ev.rate })
      } else if (ev.type === 'error') {
        throw new Error(ev.detail)
      } else if (ev.type === 'result') {
        final = {
          found: ev.found,
          hash: hash.trim(), // the pasted hash, for history/curl (not the backend tag)
          algorithm: ev.algorithm,
          password: ev.password ?? null,
          attempts: ev.attempts,
          duration_ms: ev.duration_ms,
          wordlist_exhausted: ev.wordlist_exhausted,
          wordlist: ev.wordlist,
        }
      }
    }
  }

  if (!final) throw new Error('The crack stream ended without a result.')
  return final
}

export async function crackHash(
  hash: string,
  options: CrackOptions = {},
): Promise<CrackResponse> {
  const res = await fetch(`${API_BASE}/api/crack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(crackBody(hash, options)),
  })

  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(detail)
  }

  return res.json()
}
