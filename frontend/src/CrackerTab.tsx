import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { crackHash, curlForCrack } from './api'
import AssistantPanel from './AssistantPanel'
import { Icon, ResultPanel, AdvancedOptions, VerifyBox, useAdvancedOptions, useCopy } from './CrackShared'

type Props = {
  /** Algorithm to crack, e.g. "md5". */
  algorithm: string
  /** Expected hex length for this algorithm (md5 = 32), used for a hint. */
  hexLength: number
  /** Called with a pasted hash's length when it doesn't match this tab — lets
   *  the parent auto-switch to the algorithm whose length does match. */
  onDetect?: (length: number) => void
}

// Per-algorithm example hashes that crack instantly with defaults — a
// satisfying first try. Keyed by algorithm so each tab gets a valid-length one.
const EXAMPLE_HASHES: Record<string, string> = {
  md5: '6ad14ba9986e3615423dfca256d04e3f',
  sha1: '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8', // sha1("password")
  sha224: 'd63dc919e201d7bc4c825630d2cf25fdc93d4b2f0d46706d29038d01', // sha224("password")
  sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', // sha256("password")
  sha384: 'a8b64babd0aca91a59bdbb7761b421d4f2bb38280d3a75ba0f21f2bebc45583d446c598660c94ce680c47d19c30783a7', // sha384("password")
  sha512: 'b109f3bbbc244eb82441917ed06d618b9008dd09b3befd1b5e07394c706a8bb980b1d7785e5976ec049b46df5f1326af5a2ea6d103fd07c95385ffab0cacbc86', // sha512("password")
}

function CrackerTab({ algorithm, hexLength, onDetect }: Props) {
  const [hash, setHash] = useState('')
  const [showAssistant, setShowAssistant] = useState(false)
  const opts = useAdvancedOptions()
  const { copied, copy } = useCopy()

  const mutation = useMutation({
    mutationFn: () => crackHash(hash, { algorithm, ...opts.crackParams }),
  })

  const trimmed = hash.trim()
  const isHex = /^[0-9a-fA-F]*$/.test(trimmed)
  const validLength = trimmed.length === hexLength
  const isValid = trimmed.length > 0 && isHex && validLength
  const canSubmit = isValid && !mutation.isPending

  // Auto-detect: a complete hex hash whose length doesn't match this tab tells
  // the parent to switch to the algorithm that produces that length.
  useEffect(() => {
    if (isHex && trimmed.length > 0 && trimmed.length !== hexLength) {
      onDetect?.(trimmed.length)
    }
  }, [trimmed, isHex, hexLength, onDetect])

  // This component stays mounted across md5/sha1/… (stable key), so clear any
  // stale result when the algorithm switches.
  useEffect(() => {
    mutation.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithm])

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

        <AdvancedOptions
          opts={opts}
          idPrefix="hash"
          hintHelp="Words we'll build guesses from. Helpful for personal passwords."
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
        curl={isValid ? curlForCrack(trimmed, { algorithm, ...opts.crackParams }) : undefined}
        loadingMessage={
          <>Trying candidates against the wordlist…{opts.bruteForce && ' brute-force can take a few seconds.'}</>
        }
        notFoundTip={
          <>
            💡 Try <strong>Advanced options</strong>: add a <strong>hint word</strong> and turn
            on <strong>Smart brute-force</strong> with the password length.
          </>
        }
      />

      {isValid && <VerifyBox hash={trimmed} algorithm={algorithm} />}

      {isValid && showAssistant && (
        <AssistantPanel key={trimmed} hash={trimmed} algorithm={algorithm} hints={opts.hints} />
      )}
    </div>
  )
}

export default CrackerTab
