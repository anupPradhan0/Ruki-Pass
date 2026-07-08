import { useState } from 'react'
import { useHistory, clearHistory, type HistoryEntry } from './history'

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const VERB: Record<HistoryEntry['kind'], string> = {
  crack: 'cracked',
  hash: 'hashed',
  verify: 'verified',
}

function short(s: string, n = 20): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function HistoryPanel() {
  const entries = useHistory()
  const [copied, setCopied] = useState<number | null>(null)

  if (entries.length === 0) return null

  async function copy(text: string, ts: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(ts)
      setTimeout(() => setCopied((c) => (c === ts ? null : c)), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div className="history">
      <div className="history-head">
        <span className="history-title">Recent</span>
        <button type="button" className="link-btn" onClick={clearHistory}>
          Clear
        </button>
      </div>
      <ul className="history-list">
        {entries.map((e) => (
          <li key={e.ts} className="history-item">
            <span className={`history-kind ${e.kind}`}>{VERB[e.kind]}</span>
            <span className="history-algo">{(e.algorithm ?? '?').toUpperCase()}</span>
            <code className="history-io" title={`${e.input} → ${e.output}`}>
              {short(e.input)} → <strong>{short(e.output)}</strong>
            </code>
            <span className="history-time">{ago(e.ts)}</span>
            <button
              type="button"
              className="link-btn history-copy"
              onClick={() => copy(e.output, e.ts)}
            >
              {copied === e.ts ? 'Copied' : 'Copy'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default HistoryPanel
