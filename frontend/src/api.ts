// Talks to the Ruki-Pass FastAPI backend.
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

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
  opts: { salt?: string | null; iterations?: number | null; prf?: string } = {},
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

// Algorithms the generator can produce (mirrors backend HASHABLE_ALGORITHMS).
export const HASHABLE = [
  'md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'bcrypt', 'pbkdf2',
] as const

export async function hashText(
  text: string,
  algorithm: string,
  save: boolean,
): Promise<HashResponse> {
  const res = await fetch(`${API_BASE}/api/hash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, algorithm, save }),
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
  // PBKDF2 only — ignored for plain hashes.
  salt?: string | null
  iterations?: number | null
  prf?: string
}

export async function crackHash(
  hash: string,
  options: CrackOptions = {},
): Promise<CrackResponse> {
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
    salt = null,
    iterations = null,
    prf = 'sha256',
  } = options
  const res = await fetch(`${API_BASE}/api/crack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
      salt: salt ?? null,
      iterations: iterations ?? null,
      prf,
    }),
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
