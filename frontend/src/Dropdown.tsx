import { useEffect, useRef, useState } from 'react'

// Brutalist black/white dropdown — replaces native <select>, whose open popup
// can't be styled (that's the stray blue OS highlight).
type Opt = { value: string; label: string }

type Props = {
  value: string
  onChange: (v: string) => void
  options: readonly (string | Opt)[]
  id?: string
}

function Dropdown({ value, onChange, options, id }: Props) {
  const opts: Opt[] = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = opts.find((o) => o.value === value)

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        id={id}
        className={`dropdown-btn ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <span>{current?.label ?? value}</span>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <ul className="dropdown-list" role="listbox">
          {opts.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                className={`dropdown-item ${o.value === value ? 'sel' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false) }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Dropdown
