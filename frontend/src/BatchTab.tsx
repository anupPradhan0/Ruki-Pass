import { useState } from 'react'
import { crackHash } from './api'
import { recordHistory } from './history'

// Batch cracks plain hashes (MD5–SHA-512), one per line. The algorithm is
// auto-detected from each hash's length (bcrypt/PBKDF2 aren't hex, so they land
// in their own tabs). Processed sequentially so rows update live and we don't
// hammer the backend with 50 parallel scans.

type Status = 'queued' | 'cracking' | 'found' | 'notfound' | 'error'

type Row = {
  hash: string
  status: Status
  algorithm: string | null
  password: string | null
  note: string | null
}

const EXAMPLE = [
  '5f4dcc3b5aa765d61d8327deb882cf99', // md5("password")
  '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8', // sha1("password")
  '8621ffdbc5698829397d97767ac13db3', // md5("dragon")
].join('\n')

const STATUS_LABEL: Record<Status, string> = {
  queued: 'Queued',
  cracking: 'Cracking…',
  found: 'Found',
  notfound: 'Not found',
  error: 'Error',
}

function short(s: string, n = 24): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function BatchTab() {
  const [input, setInput] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)

  const hashes = input.split('\n').map((h) => h.trim()).filter(Boolean)

  function patch(i: number, next: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...next } : r)))
  }

  async function run() {
    const list = hashes
    if (list.length === 0 || running) return
    setRunning(true)
    setRows(list.map((h) => ({ hash: h, status: 'queued', algorithm: null, password: null, note: null })))

    for (let i = 0; i < list.length; i++) {
      patch(i, { status: 'cracking' })
      try {
        // No algorithm → backend auto-detects by hash length.
        const res = await crackHash(list[i], {})
        if (res.found && res.password) {
          patch(i, { status: 'found', algorithm: res.algorithm, password: res.password })
          recordHistory({ kind: 'crack', algorithm: res.algorithm, input: res.hash, output: res.password })
        } else {
          patch(i, { status: 'notfound', algorithm: res.algorithm })
        }
      } catch (e) {
        patch(i, { status: 'error', note: (e as Error).message })
      }
    }
    setRunning(false)
  }

  const found = rows.filter((r) => r.status === 'found').length
  const done = rows.filter((r) => r.status !== 'queued' && r.status !== 'cracking').length

  return (
    <div className="cracker">
      <div className="field">
        <div className="field-head">
          <label htmlFor="batch-input">Hashes — one per line</label>
          <button type="button" className="link-btn" onClick={() => setInput(EXAMPLE)}>
            Try an example
          </button>
        </div>
        <textarea
          id="batch-input"
          className="batch-input"
          spellCheck={false}
          placeholder={'5f4dcc3b5aa765d61d8327deb882cf99\n5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8\n…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
        />
        <div className="field-foot">
          <span className="msg muted">
            {hashes.length > 0
              ? `${hashes.length.toLocaleString()} hash${hashes.length === 1 ? '' : 'es'} · plain hashes only (MD5–SHA-512), algorithm auto-detected.`
              : 'Paste plain hashes (MD5–SHA-512). bcrypt / PBKDF2 have their own tabs.'}
          </span>
        </div>
      </div>

      <button type="button" className="crack-btn" disabled={hashes.length === 0 || running} onClick={run}>
        {running ? (
          <><span className="spinner" /> Cracking {done}/{rows.length}…</>
        ) : (
          `Crack all${hashes.length ? ` (${hashes.length})` : ''}`
        )}
      </button>

      {rows.length > 0 && (
        <>
          <p className="result-meta" style={{ marginTop: '1.25rem' }}>
            {found} of {rows.length} recovered
          </p>
          <div className="batch-table-wrap">
            <table className="batch-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Hash</th>
                  <th>Algo</th>
                  <th>Status</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`batch-row ${r.status}`}>
                    <td>{i + 1}</td>
                    <td><code title={r.hash}>{short(r.hash)}</code></td>
                    <td>{r.algorithm ? r.algorithm.toUpperCase() : '—'}</td>
                    <td>
                      <span className={`batch-status ${r.status}`}>
                        {r.status === 'cracking' && <span className="spinner" />}
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td>
                      {r.password ? (
                        <code className="batch-pw">{r.password}</code>
                      ) : r.note ? (
                        <span className="msg muted" title={r.note}>{short(r.note, 30)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default BatchTab
