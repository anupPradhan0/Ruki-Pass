import { useEffect, useState } from 'react'
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import {
  type CrackResponse,
  type Special,
  type Progress,
  type HashMode,
  SPECIAL_OPTIONS,
  verifyHash,
} from './api'
import { recordHistory } from './history'
import Dropdown from './Dropdown'

// Shared by every crack tab (MD5/SHA/PBKDF2/bcrypt): icon set, the "hint
// words / rules / brute-force" advanced block, and the result panel. Each
// tab only owns its own hash-input UI and validation.

export function Icon({ name }: { name: 'check' | 'copy' | 'chevron' | 'spark' }) {
  const paths: Record<string, React.ReactNode> = {
    check: <path d="M13.5 4.5 6 12 2.5 8.5" />,
    copy: (
      <>
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
        <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" />
      </>
    ),
    chevron: <path d="M4 6l4 4 4-4" />,
    spark: <path d="M8 1.5 9.6 6 14 7.5 9.6 9 8 13.5 6.4 9 2 7.5 6.4 6z" />,
  }
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function useCopy() {
  const [copied, setCopied] = useState(false)
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }
  return { copied, copy }
}

// Hint words / rules / brute-force state, shared by every crack tab. Exposes
// both the raw fields (for controlled inputs) and the derived params ready to
// spread into crackHash()/AssistantPanel hints.
// Uploaded wordlists over this many lines are truncated (keeps the JSON POST
// sane — a targeted company list is far smaller than this).
const MAX_CUSTOM_WORDS = 100_000

export function useAdvancedOptions() {
  const [useRules, setUseRules] = useState(true)
  const [seedWords, setSeedWords] = useState('')
  const [bruteForce, setBruteForce] = useState(false)
  const [length, setLength] = useState('')
  const [special, setSpecial] = useState<Special>('unknown')
  const [symbols, setSymbols] = useState('')
  const [bruteAround, setBruteAround] = useState(false)
  const [customWords, setCustomWords] = useState<string[]>([])
  const [wordlistName, setWordlistName] = useState('')

  const extraWords = seedWords.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean)
  const lengthNum = length.trim() === '' ? null : Number(length)
  const specialChars = [...new Set(symbols.replace(/\s+/g, '').split(''))]

  async function loadWordlistFile(file: File) {
    const text = await file.text()
    const words = text.split(/\r?\n/).map((w) => w.trim()).filter(Boolean).slice(0, MAX_CUSTOM_WORDS)
    setCustomWords(words)
    setWordlistName(file.name)
  }

  function clearWordlist() {
    setCustomWords([])
    setWordlistName('')
  }

  return {
    useRules, setUseRules,
    seedWords, setSeedWords,
    bruteForce, setBruteForce,
    length, setLength,
    special, setSpecial,
    symbols, setSymbols,
    bruteAround, setBruteAround,
    customWords, wordlistName, loadWordlistFile, clearWordlist,
    crackParams: { useRules, extraWords, bruteForce, length: lengthNum, special, bruteAround, specialChars, customWords },
    hints: { extraWords, length: lengthNum, special, specialChars },
  }
}

type AdvancedOptionsState = ReturnType<typeof useAdvancedOptions>

export function AdvancedOptions({
  opts,
  idPrefix,
  hintOptional = 'optional',
  hintHelp,
}: {
  opts: AdvancedOptionsState
  idPrefix: string
  hintOptional?: string
  hintHelp: React.ReactNode
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <>
      <button
        type="button"
        className={`advanced-toggle ${showAdvanced ? 'open' : ''}`}
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
      >
        <Icon name="chevron" />
        Advanced options
        <span className="advanced-hint">hint words · rules · brute-force</span>
      </button>

      {showAdvanced && (
        <div className="advanced">
          <div className="field">
            <label htmlFor={`${idPrefix}-seed`}>Hint words <span className="opt">({hintOptional})</span></label>
            <div className="input-wrap">
              <input
                id={`${idPrefix}-seed`}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. a word — user, admin, hello"
                value={opts.seedWords}
                onChange={(e) => opts.setSeedWords(e.target.value)}
              />
            </div>
            <div className="field-foot">
              <span className="msg muted">{hintHelp}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor={`${idPrefix}-wordlist`}>
              Custom wordlist <span className="opt">(optional .txt)</span>
            </label>
            <div className="wordlist-row">
              <input
                id={`${idPrefix}-wordlist`}
                type="file"
                accept=".txt,text/plain"
                className="wordlist-input"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) opts.loadWordlistFile(file)
                  e.target.value = '' // allow re-selecting the same file
                }}
              />
              {opts.customWords.length > 0 && (
                <button type="button" className="link-btn" onClick={opts.clearWordlist}>
                  Clear
                </button>
              )}
            </div>
            <div className="field-foot">
              {opts.customWords.length > 0 ? (
                <span className="msg ok">
                  {opts.customWords.length.toLocaleString()} words from {opts.wordlistName} — tried first.
                </span>
              ) : (
                <span className="msg muted">
                  Upload your own list (one password per line) — tried before the built-in wordlist.
                </span>
              )}
            </div>
          </div>

          <label className="switch-row">
            <span className="switch-text">
              <strong>Apply rules</strong>
              <small>Mutate words: user → <code>User123</code>, <code>u$er!</code></small>
            </span>
            <input type="checkbox" className="switch" checked={opts.useRules}
              onChange={(e) => opts.setUseRules(e.target.checked)} />
          </label>

          <label className="switch-row">
            <span className="switch-text">
              <strong>Smart brute-force</strong>
              <small>Hint word + numbers: user → <code>user12345</code></small>
            </span>
            <input type="checkbox" className="switch" checked={opts.bruteForce}
              onChange={(e) => opts.setBruteForce(e.target.checked)} />
          </label>

          {opts.bruteForce && (
            <div className="brute-options">
              <p className="brute-hint">Answer what you know — it speeds things up a lot.</p>
              <div className="brute-row">
                <label className="brute-field">
                  <span>Password length</span>
                  <input type="number" min={1} max={64} placeholder="e.g. 9"
                    value={opts.length} onChange={(e) => opts.setLength(e.target.value)} />
                </label>
                <div className="brute-field">
                  <span>Special characters?</span>
                  <Dropdown value={opts.special} onChange={(v) => opts.setSpecial(v as Special)}
                    options={SPECIAL_OPTIONS} />
                </div>
              </div>
              {opts.special === 'yes' && (
                <label className="brute-field">
                  <span>Which symbols? (optional, e.g. @ ! #)</span>
                  <input
                    type="text"
                    placeholder="@"
                    value={opts.symbols}
                    onChange={(e) => opts.setSymbols(e.target.value)}
                  />
                </label>
              )}
              <label className="switch-row inset">
                <span className="switch-text">
                  <strong>Numbers before/around the word</strong>
                  <small>For shapes like <code>12user34</code></small>
                </span>
                <input type="checkbox" className="switch" checked={opts.bruteAround}
                  onChange={(e) => opts.setBruteAround(e.target.checked)} />
              </label>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function CurlButton({ curl }: { curl: string }) {
  const { copied, copy } = useCopy()
  return (
    <button type="button" className="link-btn curl-btn" onClick={() => copy(curl)}>
      {copied ? 'Copied' : 'Copy as curl'}
    </button>
  )
}

export function ResultPanel({
  mutation,
  copy,
  copied,
  showAssistant,
  setShowAssistant,
  loadingMessage,
  notFoundTip,
  curl,
  progress,
}: {
  mutation: UseMutationResult<CrackResponse, Error, void>
  copy: (text: string) => void
  copied: boolean
  showAssistant: boolean
  setShowAssistant: (fn: (v: boolean) => boolean) => void
  loadingMessage: React.ReactNode
  notFoundTip: React.ReactNode
  curl?: string
  progress?: Progress | null
}) {
  const result = mutation.data
  // Record every successful crack into session history (once per new result).
  useEffect(() => {
    if (result?.found && result.password) {
      recordHistory({
        kind: 'crack',
        algorithm: result.algorithm,
        input: result.hash,
        output: result.password,
      })
    }
  }, [result])

  if (mutation.isPending) {
    return (
      <div className="result loading">
        <span className="spinner big" />
        <div>
          <p>{loadingMessage}</p>
          {progress && (
            <p className="progress-live">
              Checked {progress.attempts.toLocaleString()} candidates ·{' '}
              ~{Math.round(progress.rate).toLocaleString()}/sec
            </p>
          )}
        </div>
      </div>
    )
  }

  if (mutation.isError) {
    return (
      <div className="result error">
        <strong>Something went wrong</strong>
        <p>{mutation.error.message}</p>
      </div>
    )
  }

  if (!result) return null

  if (result.found) {
    return (
      <div className="result found">
        <span className="result-tag">✓ Password found</span>
        <div className="password-box">
          <code>{result.password}</code>
          <button type="button" className="copy-btn" onClick={() => copy(result.password!)}>
            <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="result-meta">
          {result.attempts.toLocaleString()} attempts ·{' '}
          {result.duration_ms < 1000
            ? `${result.duration_ms.toFixed(0)} ms`
            : `${(result.duration_ms / 1000).toFixed(1)} s`}{' '}
          · {result.wordlist ?? 'n/a'}
          {curl && <> · <CurlButton curl={curl} /></>}
        </p>
      </div>
    )
  }

  return (
    <div className="result notfound">
      <span className="result-tag">Not found</span>
      <p>Tried {result.attempts.toLocaleString()} candidates — no match in {result.wordlist ?? 'the wordlist'}.</p>
      <p className="result-tip">{notFoundTip}</p>
      <div className="result-actions">
        <button type="button" className="assist-cta" onClick={() => setShowAssistant((v) => !v)}>
          🤖 {showAssistant ? 'Hide AI assistant' : 'Ask the AI assistant'}
        </button>
        {curl && <CurlButton curl={curl} />}
      </div>
    </div>
  )
}

// "Have a guess? Check it" — tests a single plaintext against the hash instantly,
// no wordlist search. Shared by every crack tab; PBKDF2 passes salt/iterations.
export function VerifyBox({
  hash,
  algorithm,
  salt,
  iterations,
  prf,
  hashMode,
}: {
  hash: string
  algorithm: string
  salt?: string | null
  iterations?: number | null
  prf?: string
  hashMode?: HashMode
}) {
  const [candidate, setCandidate] = useState('')

  const mutation = useMutation({
    mutationFn: () => verifyHash(hash, candidate, { algorithm, salt, iterations, prf, hashMode }),
    onSuccess: (res) => {
      if (res.match) {
        recordHistory({ kind: 'verify', algorithm, input: hash, output: candidate })
      }
    },
  })

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (candidate && !mutation.isPending) mutation.mutate()
  }

  const res = mutation.data

  return (
    <form className="verify" onSubmit={onSubmit}>
      <label htmlFor="verify-input">Have a guess? Check it directly</label>
      <div className="verify-row">
        <div className="input-wrap">
          <input
            id="verify-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Type a password to test against this hash…"
            value={candidate}
            onChange={(e) => {
              setCandidate(e.target.value)
              if (mutation.data || mutation.isError) mutation.reset()
            }}
          />
        </div>
        <button type="submit" className="copy-btn" disabled={!candidate || mutation.isPending}>
          {mutation.isPending ? 'Checking…' : 'Check'}
        </button>
      </div>
      <div className="field-foot">
        {mutation.isError ? (
          <span className="msg warn">{mutation.error.message}</span>
        ) : res?.match ? (
          <span className="msg ok">✓ Match — that's the password.</span>
        ) : res && !res.match ? (
          <span className="msg warn">✗ Not a match.</span>
        ) : (
          <span className="msg muted">Instant — checks one guess, no wordlist search.</span>
        )}
      </div>
    </form>
  )
}
