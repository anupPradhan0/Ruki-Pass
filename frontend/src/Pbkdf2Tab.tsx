import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { crackHash, type Special } from './api'
import AssistantPanel from './AssistantPanel'

// RFC 6070 test vector: PBKDF2-HMAC-SHA1("password", "salt", 1, 20). One
// iteration + a wordlist word means it cracks instantly — a satisfying first try.
const EXAMPLE = {
  hash: '0c60c80f961f0e71f3a9b524af6012062fe037a6',
  salt: 'salt',
  iterations: '1',
  prf: 'sha1',
}

// A pasted value like "pbkdf2_sha256$260000$salt$hash" carries its own salt and
// iteration count, so the separate fields are hidden when we detect it.
const ENCODED_RE = /^pbkdf2_[a-z0-9]+\$\d+\$/i

const PRFS = ['sha256', 'sha1', 'sha512', 'sha224', 'sha384', 'md5']

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

function Pbkdf2Tab() {
  const [hash, setHash] = useState('')
  const [salt, setSalt] = useState('')
  const [iterations, setIterations] = useState('')
  const [prf, setPrf] = useState('sha256')
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

  const trimmed = hash.trim()
  const isEncoded = ENCODED_RE.test(trimmed)
  // Encoded strings embed salt + iterations; raw hashes need both supplied.
  const fieldsOk = isEncoded || (salt.trim() !== '' && iterations.trim() !== '' && Number(iterations) >= 1)
  const isValid = trimmed.length > 0 && fieldsOk

  const mutation = useMutation({
    mutationFn: () =>
      crackHash(trimmed, {
        algorithm: 'pbkdf2',
        salt: isEncoded ? null : salt.trim(),
        iterations: isEncoded ? null : Number(iterations),
        prf,
        useRules,
        extraWords: seedWords
          .split(/[\s,]+/)
          .map((w) => w.trim())
          .filter(Boolean),
        bruteForce,
        length: length.trim() === '' ? null : Number(length),
        special,
        bruteAround,
        specialChars: [...new Set(symbols.replace(/\s+/g, '').split(''))],
      }),
  })

  const canSubmit = isValid && !mutation.isPending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (canSubmit) mutation.mutate()
  }

  function loadExample() {
    setHash(EXAMPLE.hash)
    setSalt(EXAMPLE.salt)
    setIterations(EXAMPLE.iterations)
    setPrf(EXAMPLE.prf)
    mutation.reset()
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
        {/* ---- Hash / encoded string input ---- */}
        <div className="field">
          <div className="field-head">
            <label htmlFor="pbkdf2-hash">PBKDF2 hash</label>
            <button type="button" className="link-btn" onClick={loadExample}>
              <Icon name="spark" /> Try an example
            </button>
          </div>

          <div className={`input-wrap ${trimmed && !isValid ? 'invalid' : ''} ${isValid ? 'valid' : ''}`}>
            <input
              id="pbkdf2-hash"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Encoded (pbkdf2_sha256$…) or the raw derived key (hex/base64)"
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
            {isEncoded ? (
              <span className="msg ok">Encoded string — salt &amp; iterations read from it.</span>
            ) : trimmed.length === 0 ? (
              <span className="msg muted">
                Paste a <code>pbkdf2_sha256$iterations$salt$hash</code> string, or the raw
                key plus the salt &amp; iterations below.
              </span>
            ) : !fieldsOk ? (
              <span className="msg warn">Also fill in the salt and iteration count.</span>
            ) : (
              <span className="msg ok">Ready to crack.</span>
            )}
          </div>
        </div>

        {/* ---- Salt / iterations / prf (only when not an encoded string) ---- */}
        {!isEncoded && (
          <div className="brute-options">
            <div className="brute-row">
              <label className="brute-field">
                <span>Salt</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. salt"
                  value={salt}
                  onChange={(e) => setSalt(e.target.value)}
                />
              </label>
              <label className="brute-field">
                <span>Iterations</span>
                <input
                  type="number"
                  min={1}
                  max={5000000}
                  placeholder="e.g. 260000"
                  value={iterations}
                  onChange={(e) => setIterations(e.target.value)}
                />
              </label>
              <label className="brute-field">
                <span>Algorithm (PRF)</span>
                <select value={prf} onChange={(e) => setPrf(e.target.value)}>
                  {PRFS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

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
              <label htmlFor="pbkdf2-seed">Hint words <span className="opt">(recommended)</span></label>
              <div className="input-wrap">
                <input
                  id="pbkdf2-seed"
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
                  PBKDF2 is deliberately slow, so a good hint word matters far more
                  here than for plain hashes.
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
          <p>Deriving keys for each candidate… PBKDF2 is slow, so this can take a while.</p>
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
              Tried {result.attempts.toLocaleString()} candidates — no match.
            </p>
            <p className="result-tip">
              💡 PBKDF2 is intentionally slow, so the full wordlist is out of reach.
              Open <strong>Advanced options</strong> and add a <strong>hint word</strong> —
              that's the practical way to crack it.
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
        <AssistantPanel
          key={trimmed}
          hash={trimmed}
          algorithm="pbkdf2"
          salt={isEncoded ? null : salt.trim()}
          iterations={isEncoded ? null : Number(iterations)}
          prf={prf}
        />
      )}
    </div>
  )
}

export default Pbkdf2Tab
