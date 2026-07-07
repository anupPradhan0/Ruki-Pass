import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { hashText, HASHABLE } from './api'
import Dropdown from './Dropdown'

function Hasher() {
  const [text, setText] = useState('')
  const [algorithm, setAlgorithm] = useState('sha256')
  const [save, setSave] = useState(true)
  const [copied, setCopied] = useState(false)

  const mutation = useMutation({
    mutationFn: () => hashText(text, algorithm, save),
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

  return (
    <section className="panel">
      <h2 className="panel-title">Make a hash</h2>
      <p className="panel-subtitle">
        Type a password, pick an algorithm, and get its hash — the reverse of cracking.
      </p>

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
        </div>

        <div className="brute-options">
          <div className="brute-row">
            <div className="brute-field">
              <span>Algorithm</span>
              <Dropdown value={algorithm} onChange={setAlgorithm} options={HASHABLE} />
            </div>
          </div>
        </div>

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
          </p>
        </div>
      )}
    </section>
  )
}

export default Hasher
