import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { crackHashStream, curlForCrack, type Progress } from './api'
import AssistantPanel from './AssistantPanel'
import Dropdown from './Dropdown'
import { Icon, ResultPanel, AdvancedOptions, VerifyBox, useAdvancedOptions, useCopy } from './CrackShared'

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

function Pbkdf2Tab() {
  const [hash, setHash] = useState('')
  const [salt, setSalt] = useState('')
  const [iterations, setIterations] = useState('')
  const [prf, setPrf] = useState('sha256')
  const [showAssistant, setShowAssistant] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const opts = useAdvancedOptions()
  const { copied, copy } = useCopy()

  const trimmed = hash.trim()
  const isEncoded = ENCODED_RE.test(trimmed)
  // Encoded strings embed salt + iterations; raw hashes need both supplied.
  const fieldsOk = isEncoded || (salt.trim() !== '' && iterations.trim() !== '' && Number(iterations) >= 1)
  const isValid = trimmed.length > 0 && fieldsOk

  // Salt/iterations/prf shared by crack, curl, and verify. Encoded strings carry
  // their own, so we send null and let the backend read them from the string.
  const kdf = {
    salt: isEncoded ? null : salt.trim(),
    iterations: isEncoded ? null : Number(iterations),
    prf,
  }

  const mutation = useMutation({
    mutationFn: () =>
      crackHashStream(trimmed, { algorithm: 'pbkdf2', ...kdf, ...opts.crackParams }, setProgress),
    onMutate: () => setProgress(null),
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
              <div className="brute-field">
                <span>Algorithm (PRF)</span>
                <Dropdown value={prf} onChange={setPrf} options={PRFS} />
              </div>
            </div>
          </div>
        )}

        <AdvancedOptions
          opts={opts}
          idPrefix="pbkdf2"
          hintOptional="recommended"
          hintHelp="PBKDF2 is deliberately slow, so a good hint word matters far more here than for plain hashes."
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
        progress={progress}
        showAssistant={showAssistant}
        setShowAssistant={setShowAssistant}
        curl={isValid ? curlForCrack(trimmed, { algorithm: 'pbkdf2', ...kdf, ...opts.crackParams }) : undefined}
        loadingMessage="Deriving keys for each candidate… PBKDF2 is slow, so this can take a while."
        notFoundTip={
          <>
            💡 PBKDF2 is intentionally slow, so the full wordlist is out of reach.
            Open <strong>Advanced options</strong> and add a <strong>hint word</strong> —
            that's the practical way to crack it.
          </>
        }
      />

      {isValid && (
        <VerifyBox hash={trimmed} algorithm="pbkdf2" salt={kdf.salt} iterations={kdf.iterations} prf={prf} />
      )}

      {isValid && showAssistant && (
        <AssistantPanel
          key={trimmed}
          hash={trimmed}
          algorithm="pbkdf2"
          salt={isEncoded ? null : salt.trim()}
          iterations={isEncoded ? null : Number(iterations)}
          prf={prf}
          hints={opts.hints}
        />
      )}
    </div>
  )
}

export default Pbkdf2Tab
