import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { crackHash } from './api'

type Props = {
  /** Algorithm to crack, e.g. "md5". */
  algorithm: string
  /** Expected hex length for this algorithm (md5 = 32), used for a hint. */
  hexLength: number
}

function CrackerTab({ algorithm, hexLength }: Props) {
  const [hash, setHash] = useState('')

  const mutation = useMutation({
    mutationFn: () => crackHash(hash, algorithm),
  })

  const trimmed = hash.trim()
  const isHex = /^[0-9a-fA-F]*$/.test(trimmed)
  const validLength = trimmed.length === hexLength
  const canSubmit = trimmed.length > 0 && isHex && validLength && !mutation.isPending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (canSubmit) mutation.mutate()
  }

  const result = mutation.data

  return (
    <div className="cracker">
      <form onSubmit={onSubmit} className="cracker-form">
        <label htmlFor="hash-input" className="cracker-label">
          {algorithm.toUpperCase()} hash (hex string)
        </label>
        <input
          id="hash-input"
          className="cracker-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Paste a ${hexLength}-character ${algorithm.toUpperCase()} hash…`}
          value={hash}
          onChange={(e) => setHash(e.target.value)}
        />

        {trimmed.length > 0 && !isHex && (
          <p className="cracker-warn">Only hex characters (0–9, a–f) are allowed.</p>
        )}
        {trimmed.length > 0 && isHex && !validLength && (
          <p className="cracker-warn">
            {algorithm.toUpperCase()} hashes are {hexLength} characters — you have{' '}
            {trimmed.length}.
          </p>
        )}

        <button type="submit" className="cracker-button" disabled={!canSubmit}>
          {mutation.isPending ? 'Cracking…' : 'Crack it'}
        </button>
      </form>

      {mutation.isError && (
        <div className="cracker-result error">
          {(mutation.error as Error).message}
        </div>
      )}

      {result && !mutation.isPending && (
        <div className={`cracker-result ${result.found ? 'found' : 'notfound'}`}>
          {result.found ? (
            <>
              <span className="result-label">Password found</span>
              <code className="result-password">{result.password}</code>
              <p className="result-meta">
                {result.attempts.toLocaleString()} attempts ·{' '}
                {result.duration_ms.toFixed(1)} ms · wordlist:{' '}
                {result.wordlist ?? 'n/a'}
              </p>
            </>
          ) : (
            <>
              <span className="result-label">Not found</span>
              <p className="result-meta">
                This hash isn't in the wordlist
                {result.wordlist ? ` (${result.wordlist})` : ''}. Tried{' '}
                {result.attempts.toLocaleString()} candidates.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default CrackerTab
