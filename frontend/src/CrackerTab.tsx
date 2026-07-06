import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { crackHash, type Special } from './api'
import AssistantPanel from './AssistantPanel'

type Props = {
  /** Algorithm to crack, e.g. "md5". */
  algorithm: string
  /** Expected hex length for this algorithm (md5 = 32), used for a hint. */
  hexLength: number
}

// Per-algorithm example hashes that crack instantly with defaults — a
// satisfying first try. Keyed by algorithm so each tab gets a valid-length one.
const EXAMPLE_HASHES: Record<string, string> = {
  md5: '6ad14ba9986e3615423dfca256d04e3f',
  sha1: '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8', // sha1("password")
  sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', // sha256("password")
}

function Icon({ name }: { name: 'check' | 'copy' | 'chevron' | 'spark' }) {
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

function CrackerTab({ algorithm, hexLength }: Props) {
  const [hash, setHash] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [useRules, setUseRules] = useState(true)
  const [seedWords, setSeedWords] = useState('')
  const [bruteForce, setBruteForce] = useState(false)
  const [length, setLength] = useState('')
  const [special, setSpecial] = useState<Special>('unknown')
  const [symbols, setSymbols] = useState('')
  const [bruteAround, setBruteAround] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)

  const mutation = useMutation({
    mutationFn: () =>
      crackHash(hash, {
        algorithm,
        useRules,
        extraWords: seedWords
          .split(/[\s,]+/)
          .map((w) => w.trim())
          .filter(Boolean),
        bruteForce,
        length: length.trim() === '' ? null : Number(length),
        special,
        bruteAround,
        // Distinct symbol characters the user typed, e.g. "@ !" -> ["@","!"].
        specialChars: [...new Set(symbols.replace(/\s+/g, '').split(''))],
      }),
  })

  const trimmed = hash.trim()
  const isHex = /^[0-9a-fA-F]*$/.test(trimmed)
  const validLength = trimmed.length === hexLength
  const isValid = trimmed.length > 0 && isHex && validLength
  const canSubmit = isValid && !mutation.isPending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (canSubmit) mutation.mutate()
  }

  async function copyPassword(pw: string) {
    try {
      await navigator.clipboard.writeText(pw)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  const result = mutation.data

  return (
    <div className="cracker">
      <form onSubmit={onSubmit} className="cracker-form">
        {/* ---- Hash input ---- */}
        <div className="field">
          <div className="field-head">
            <label htmlFor="hash-input">{algorithm.toUpperCase()} hash</label>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setHash(EXAMPLE_HASHES[algorithm] ?? EXAMPLE_HASHES.md5)
                mutation.reset()
              }}
            >
              <Icon name="spark" /> Try an example
            </button>
          </div>

          <div className={`input-wrap ${trimmed && !isValid ? 'invalid' : ''} ${isValid ? 'valid' : ''}`}>
            <input
              id="hash-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={`Paste a ${hexLength}-character hash…`}
              value={hash}
              onChange={(e) => setHash(e.target.value)}
            />
            {isValid && <span className="input-check"><Icon name="check" /></span>}
            {hash && (
              <button type="button" className="input-clear" aria-label="Clear"
                onClick={() => { setHash(''); mutation.reset() }}>
                ×
              </button>
            )}
          </div>

          <div className="field-foot">
            {trimmed.length > 0 && !isHex ? (
              <span className="msg warn">Only hex characters (0–9, a–f).</span>
            ) : trimmed.length > 0 && !validLength ? (
              <span className="msg warn">
                Needs {hexLength} characters — you have {trimmed.length}.
              </span>
            ) : isValid ? (
              <span className="msg ok">Looks like a valid {algorithm.toUpperCase()} hash.</span>
            ) : (
              <span className="msg muted">{algorithm.toUpperCase()} hashes are {hexLength} hex characters.</span>
            )}
          </div>
        </div>

        {/* ---- Advanced options ---- */}
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
              <label htmlFor="seed-input">Hint words <span className="opt">(optional)</span></label>
              <div className="input-wrap">
                <input
                  id="seed-input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. a word — user, admin, hello"
                  value={seedWords}
                  onChange={(e) => setSeedWords(e.target.value)}
                />
              </div>
              <div className="field-foot">
                <span className="msg muted">
                  Words we'll build guesses from. Helpful for personal passwords.
                </span>
              </div>
            </div>

            <label className="switch-row">
              <span className="switch-text">
                <strong>Apply rules</strong>
                <small>Mutate words: user → <code>User123</code>, <code>u$er!</code></small>
              </span>
              <input type="checkbox" className="switch" checked={useRules}
                onChange={(e) => setUseRules(e.target.checked)} />
            </label>

            <label className="switch-row">
              <span className="switch-text">
                <strong>Smart brute-force</strong>
                <small>Hint word + numbers: user → <code>user12345</code></small>
              </span>
              <input type="checkbox" className="switch" checked={bruteForce}
                onChange={(e) => setBruteForce(e.target.checked)} />
            </label>

            {bruteForce && (
              <div className="brute-options">
                <p className="brute-hint">Answer what you know — it speeds things up a lot.</p>
                <div className="brute-row">
                  <label className="brute-field">
                    <span>Password length</span>
                    <input type="number" min={1} max={64} placeholder="e.g. 9"
                      value={length} onChange={(e) => setLength(e.target.value)} />
                  </label>
                  <label className="brute-field">
                    <span>Special characters?</span>
                    <select value={special} onChange={(e) => setSpecial(e.target.value as Special)}>
                      <option value="unknown">Not sure</option>
                      <option value="no">No (none)</option>
                      <option value="yes">Yes (has one)</option>
                    </select>
                  </label>
                </div>
                {special === 'yes' && (
                  <label className="brute-field">
                    <span>Which symbols? (optional, e.g. @ ! #)</span>
                    <input
                      type="text"
                      placeholder="@"
                      value={symbols}
                      onChange={(e) => setSymbols(e.target.value)}
                    />
                    <span className="msg muted" style={{ fontSize: '0.78rem' }}>
                      Knowing the exact symbol makes it far faster. The symbol can sit
                      anywhere — even between numbers (<code>ruki123@123</code>).
                    </span>
                  </label>
                )}
                <label className="switch-row inset">
                  <span className="switch-text">
                    <strong>Numbers before/around the word</strong>
                    <small>For shapes like <code>12user34</code></small>
                  </span>
                  <input type="checkbox" className="switch" checked={bruteAround}
                    onChange={(e) => setBruteAround(e.target.checked)} />
                </label>
              </div>
            )}
          </div>
        )}

        <button type="submit" className="crack-btn" disabled={!canSubmit}>
          {mutation.isPending ? (
            <><span className="spinner" /> Cracking…</>
          ) : (
            'Crack it'
          )}
        </button>
      </form>

      {/* ---- Result ---- */}
      {mutation.isPending && (
        <div className="result loading">
          <span className="spinner big" />
          <p>
            Trying candidates against the wordlist…
            {bruteForce && ' brute-force can take a few seconds.'}
          </p>
        </div>
      )}

      {mutation.isError && !mutation.isPending && (
        <div className="result error">
          <strong>Something went wrong</strong>
          <p>{(mutation.error as Error).message}</p>
        </div>
      )}

      {result && !mutation.isPending && (
        result.found ? (
          <div className="result found">
            <span className="result-tag">✓ Password found</span>
            <div className="password-box">
              <code>{result.password}</code>
              <button type="button" className="copy-btn"
                onClick={() => copyPassword(result.password!)}>
                <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="result-meta">
              {result.attempts.toLocaleString()} attempts ·{' '}
              {result.duration_ms < 1000
                ? `${result.duration_ms.toFixed(0)} ms`
                : `${(result.duration_ms / 1000).toFixed(1)} s`}{' '}
              · {result.wordlist ?? 'n/a'}
            </p>
          </div>
        ) : (
          <div className="result notfound">
            <span className="result-tag">Not found</span>
            <p>
              Tried {result.attempts.toLocaleString()} candidates — no match in{' '}
              {result.wordlist ?? 'the wordlist'}.
            </p>
            <p className="result-tip">
              💡 Try <strong>Advanced options</strong>: add a <strong>hint word</strong> and turn
              on <strong>Smart brute-force</strong> with the password length.
            </p>
            <button
              type="button"
              className="assist-cta"
              onClick={() => setShowAssistant((v) => !v)}
            >
              🤖 {showAssistant ? 'Hide AI assistant' : 'Ask the AI assistant'}
            </button>
          </div>
        )
      )}

      {isValid && showAssistant && (
        <AssistantPanel key={trimmed} hash={trimmed} algorithm={algorithm} />
      )}
    </div>
  )
}

export default CrackerTab
