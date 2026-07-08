import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { hashText, curlForHash, HASHABLE, HASH_MODE_OPTIONS, type HashMode } from './api'
import { recordHistory } from './history'
import HistoryPanel from './HistoryPanel'
import Dropdown from './Dropdown'

// 'sha256' -> 'SHA-256'; everything else (md5, bcrypt, pbkdf2) is just
// uppercased by the .tab CSS itself.
function algoLabel(algo: string): string {
  return algo.startsWith('sha') ? `SHA-${algo.slice(3)}` : algo
}

// Salt/HMAC only applies to plain hashes; bcrypt/PBKDF2 salt themselves.
const SALTABLE = (a: string) => a !== 'bcrypt' && a !== 'pbkdf2'

function Hasher() {
  const [text, setText] = useState('')
  const [algorithm, setAlgorithm] = useState('md5')
  const [save, setSave] = useState(true)
  const [hashMode, setHashMode] = useState<HashMode>('plain')
  const [salt, setSalt] = useState('')
  const [copied, setCopied] = useState(false)

  const saltable = SALTABLE(algorithm)
  const mode = saltable ? hashMode : 'plain'
  const hashOpts = { salt: mode === 'plain' ? null : salt, hashMode: mode }

  const mutation = useMutation({
    mutationFn: () => hashText(text, algorithm, save, hashOpts),
  })

  const canSubmit = text.length > 0 && !mutation.isPending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (canSubmit) mutation.mutate()
  }

  async function copyHash(h: string) {
    try {
      await navigator.clipboard.writeText(h)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  const result = mutation.data

  // Record each generated hash into session history (once per new result).
  useEffect(() => {
    if (result) {
      recordHistory({ kind: 'hash', algorithm: result.algorithm, input: text, output: result.hash })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  return (
    <section className="panel">
      <h2 className="panel-title">Make a hash</h2>
      <p className="panel-subtitle">
        Type a password, pick an algorithm, and get its hash.
      </p>

      <div className="tabs" role="tablist">
        {HASHABLE.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={algorithm === a}
            className={`tab ${algorithm === a ? 'active' : ''}`}
            onClick={() => setAlgorithm(a)}
          >
            {algoLabel(a)}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="cracker-form">
        <div className="field">
          <label htmlFor="plain-input">Password / text</label>
          <div className="input-wrap">
            <input
              id="plain-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Anything you want to hash…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {text && (
              <button type="button" className="input-clear" aria-label="Clear"
                onClick={() => { setText(''); mutation.reset() }}>
                ×
              </button>
            )}
          </div>
          <div className="field-foot">
            <span className="msg muted">Will be hashed with {algoLabel(algorithm).toUpperCase()}.</span>
          </div>
        </div>

        {saltable && (
          <div className="brute-options">
            <div className="brute-row">
              <div className="brute-field">
                <span>Salted / HMAC?</span>
                <Dropdown value={hashMode} onChange={(v) => setHashMode(v as HashMode)}
                  options={HASH_MODE_OPTIONS} />
              </div>
              {hashMode !== 'plain' && (
                <label className="brute-field">
                  <span>{hashMode === 'hmac' ? 'Key / secret' : 'Salt'}</span>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. s4lt"
                    value={salt}
                    onChange={(e) => setSalt(e.target.value)}
                  />
                </label>
              )}
            </div>
          </div>
        )}

        <label className="switch-row">
          <span className="switch-text">
            <strong>Save to improve cracking</strong>
            <small>Adds this password to our wordlist so the cracker learns it. Uncheck to skip.</small>
          </span>
          <input type="checkbox" className="switch" checked={save}
            onChange={(e) => setSave(e.target.checked)} />
        </label>

        <button type="submit" className="crack-btn" disabled={!canSubmit}>
          {mutation.isPending ? <><span className="spinner" /> Hashing…</> : 'Generate hash'}
        </button>
      </form>

      {mutation.isError && (
        <div className="result error">
          <strong>Something went wrong</strong>
          <p>{(mutation.error as Error).message}</p>
        </div>
      )}

      {result && !mutation.isPending && (
        <div className="result found">
          <span className="result-tag">✓ {result.algorithm} hash</span>
          <div className="password-box">
            <code>{result.hash}</code>
            <button type="button" className="copy-btn" onClick={() => copyHash(result.hash)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="result-meta">
            {result.saved ? 'Saved to the learning wordlist.' : 'Not saved.'}
            {' · '}
            <CurlLink curl={curlForHash(text, algorithm, save, hashOpts)} />
          </p>
        </div>
      )}

      <HistoryPanel />
    </section>
  )
}

function CurlLink({ curl }: { curl: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(curl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }
  return (
    <button type="button" className="link-btn curl-btn" onClick={copy}>
      {copied ? 'Copied' : 'Copy as curl'}
    </button>
  )
}

export default Hasher
