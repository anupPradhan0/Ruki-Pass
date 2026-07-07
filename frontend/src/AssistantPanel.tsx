import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { assist, getAssistStatus, type TranscriptMessage } from './api'

type Props = {
  hash: string
  algorithm: string
  // PBKDF2 only — the assistant needs the salt/iterations to run a crack.
  salt?: string | null
  iterations?: number | null
  prf?: string
  // What the user already typed in the form, so the AI skips re-asking it.
  hints?: {
    extraWords?: string[]
    length?: number | null
    special?: string
    specialChars?: string[]
  }
}

// Mask anything that looks like a key/token in any text we render.
function maskSecrets(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[hidden]')
    .replace(/\bAQ\.[0-9A-Za-z_-]{10,}/g, '[hidden]')
    .replace(/\bya29\.[0-9A-Za-z_-]+/g, '[hidden]')
    .replace(/\bsk-[0-9A-Za-z_-]{15,}/g, '[hidden]')
}

// Reject anything that looks like an API key / token so it never leaves the box.
function looksLikeSecret(s: string): boolean {
  const t = s.trim()
  return (
    /^AIza[0-9A-Za-z_-]{20,}$/.test(t) || // Gemini API key
    /^AQ\.[0-9A-Za-z_-]{10,}/.test(t) || // Google OAuth token
    /^ya29\./.test(t) || // Google OAuth access token
    /^sk-[0-9A-Za-z_-]{15,}/.test(t) || // generic secret
    (t.length > 25 && !/\s/.test(t) && /^[A-Za-z0-9_.-]+$/.test(t)) // long token-ish
  )
}

function AssistantPanel({ hash, algorithm, salt, iterations, prf, hints }: Props) {
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [answer, setAnswer] = useState('')
  const [started, setStarted] = useState(false)
  const [secretWarning, setSecretWarning] = useState(false)

  const status = useQuery({
    queryKey: ['assist-status'],
    queryFn: getAssistStatus,
  })

  const turn = useMutation({
    mutationFn: (t: TranscriptMessage[]) =>
      assist(hash, algorithm, t, {
        salt,
        iterations,
        prf,
        extraWords: hints?.extraWords,
        length: hints?.length,
        special: hints?.special,
        specialChars: hints?.specialChars,
      }),
    onSuccess: (res) => setTranscript(res.transcript),
  })

  const last = turn.data
  const waiting = turn.isPending

  function start() {
    setStarted(true)
    setTranscript([])
    turn.mutate([])
  }

  function sendAnswer() {
    const text = answer.trim()
    if (!text || waiting) return
    if (looksLikeSecret(text)) {
      setSecretWarning(true)
      setAnswer('')
      return
    }
    setSecretWarning(false)
    const next: TranscriptMessage[] = [...transcript, { role: 'user', text }]
    setTranscript(next)
    setAnswer('')
    turn.mutate(next)
  }

  if (status.isLoading) {
    return <div className="assist"><p className="msg muted">Checking AI assistant…</p></div>
  }

  if (!status.data?.available) {
    return (
      <div className="assist unavailable">
        <strong>AI assistant is off</strong>
        <p>
          Add <code>GEMINI_API_KEY</code> to <code>backend/.env</code> to enable it
          (model: <code>{status.data?.model ?? 'gemma-4-26b-a4b-it'}</code>), then restart the backend.
        </p>
      </div>
    )
  }

  return (
    <div className="assist">
      <div className="assist-head">
        <span className="assist-title">🤖 AI assistant</span>
        <span className="assist-model">{maskSecrets(status.data.model)}</span>
      </div>

      {!started ? (
        <p className="assist-intro">
          Can't crack it automatically? The assistant will ask you a few questions
          about the password, then try smarter strategies.
        </p>
      ) : (
        <div className="assist-chat">
          {transcript.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.role === 'system' ? <em>{maskSecrets(m.text)}</em> : maskSecrets(m.text)}
            </div>
          ))}
          {waiting && <div className="bubble assistant"><span className="spinner" /> thinking…</div>}
        </div>
      )}

      {turn.isError && (
        <div className="result error">
          <p>{(turn.error as Error).message}</p>
        </div>
      )}

      {/* Outcome banners */}
      {last?.status === 'solved' && !waiting && (
        <div className="result found">
          <span className="result-tag">✓ Recovered with AI</span>
          <div className="password-box"><code>{last.password}</code></div>
          <p className="result-meta">
            {last.attempts?.toLocaleString()} attempts · {last.strategy_note}
          </p>
        </div>
      )}
      {(last?.status === 'gave_up' || last?.status === 'exhausted') && !waiting && (
        <div className="result notfound">
          <span className="result-tag">{last.status === 'gave_up' ? 'Assistant gave up' : 'No luck this round'}</span>
          <p>{last.reason || last.thought}</p>
          <button type="button" className="link-btn" onClick={() => turn.mutate(transcript)}>
            Keep trying
          </button>
        </div>
      )}

      {/* Controls */}
      {!started ? (
        <button type="button" className="crack-btn" onClick={start} disabled={waiting}>
          {waiting ? <><span className="spinner" /> Starting…</> : 'Start AI assistant'}
        </button>
      ) : last?.status === 'need_input' && !waiting ? (
        <div>
          <div className="assist-input">
            <input
              type="text"
              placeholder="Answer the question — don't paste keys or secrets"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendAnswer()}
            />
            <button type="button" className="crack-btn" onClick={sendAnswer} disabled={!answer.trim()}>
              Send
            </button>
          </div>
          {secretWarning && (
            <p className="msg warn" style={{ marginTop: '0.5rem' }}>
              That looks like an API key or token — don't paste secrets here. Your
              Gemini key goes in <code>backend/.env</code> as <code>GEMINI_API_KEY</code>.
              This box is only for answering the assistant.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default AssistantPanel
