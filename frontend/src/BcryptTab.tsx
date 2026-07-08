import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { crackHash } from './api'
import AssistantPanel from './AssistantPanel'
import { Icon, ResultPanel, AdvancedOptions, useAdvancedOptions, useCopy } from './CrackShared'

// A real bcrypt("password") at cost 4 — low cost means it cracks instantly, a
// satisfying first try. Verified by a backend test so it can't silently break.
const EXAMPLE_HASH = '$2b$04$MvjLNNutkRqI/ZFxl3bR8uJZ790wRypqJSJhrmaUYsX7qyucqiqcW'

// bcrypt strings: $2a$/$2b$/$2x$/$2y$ + two-digit cost + 53 base64-ish chars.
const BCRYPT_RE = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/

function BcryptTab() {
  const [hash, setHash] = useState('')
  const [showAssistant, setShowAssistant] = useState(false)
  const opts = useAdvancedOptions()
  const { copied, copy } = useCopy()

  const trimmed = hash.trim()
  const isValid = BCRYPT_RE.test(trimmed)
  const cost = isValid ? Number(trimmed.split('$')[2]) : null

  const mutation = useMutation({
    mutationFn: () => crackHash(trimmed, { algorithm: 'bcrypt', ...opts.crackParams }),
  })

  const canSubmit = isValid && !mutation.isPending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (canSubmit) mutation.mutate()
  }

  return (
    <div className="cracker">
      <form onSubmit={onSubmit} className="cracker-form">
        {/* ---- Hash input ---- */}
        <div className="field">
          <div className="field-head">
            <label htmlFor="bcrypt-hash">bcrypt hash</label>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setHash(EXAMPLE_HASH)
                mutation.reset()
              }}
            >
              <Icon name="spark" /> Try an example
            </button>
          </div>

          <div className={`input-wrap ${trimmed && !isValid ? 'invalid' : ''} ${isValid ? 'valid' : ''}`}>
            <input
              id="bcrypt-hash"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a $2b$… hash (60 characters)"
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
            {trimmed.length > 0 && !isValid ? (
              <span className="msg warn">
                Needs a bcrypt hash like <code>$2b$12$…</code> (60 characters).
              </span>
            ) : isValid ? (
              <span className="msg ok">
                Valid bcrypt hash — work factor {cost}. Salt &amp; cost are built in.
              </span>
            ) : (
              <span className="msg muted">
                bcrypt hashes start with <code>$2a$</code>/<code>$2b$</code>/<code>$2y$</code> and are 60 characters.
              </span>
            )}
          </div>
        </div>

        <AdvancedOptions
          opts={opts}
          idPrefix="bcrypt"
          hintOptional="recommended"
          hintHelp="bcrypt is the slowest target, so a good hint word matters most here — the full wordlist is out of reach."
        />

        <button type="submit" className="crack-btn" disabled={!canSubmit}>
          {mutation.isPending ? (
            <><span className="spinner" /> Cracking…</>
          ) : (
            'Crack it'
          )}
        </button>
      </form>

      <ResultPanel
        mutation={mutation}
        copy={copy}
        copied={copied}
        showAssistant={showAssistant}
        setShowAssistant={setShowAssistant}
        loadingMessage="Hashing each candidate with bcrypt… this is slow by design, so give it a moment."
        notFoundTip={
          <>
            💡 bcrypt is intentionally very slow, so the full wordlist can't be scanned.
            Open <strong>Advanced options</strong> and add a <strong>hint word</strong> —
            that's the only practical way to crack it.
          </>
        }
      />

      {isValid && showAssistant && (
        <AssistantPanel key={trimmed} hash={trimmed} algorithm="bcrypt" hints={opts.hints} />
      )}
    </div>
  )
}

export default BcryptTab
