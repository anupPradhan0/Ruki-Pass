// Talks to the Ruki-Pass FastAPI backend.
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

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

export type CrackOptions = {
  algorithm?: string
  useRules?: boolean
  extraWords?: string[]
}

export async function crackHash(
  hash: string,
  options: CrackOptions = {},
): Promise<CrackResponse> {
  const { algorithm, useRules = true, extraWords = [] } = options
  const res = await fetch(`${API_BASE}/api/crack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hash: hash.trim(),
      algorithm,
      use_rules: useRules,
      extra_words: extraWords,
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
