import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import CrackerTab from './CrackerTab'
import Pbkdf2Tab from './Pbkdf2Tab'

const ORG_URL = 'https://github.com/Ruki111'
const REPO_URL = 'https://github.com/Ruki111/Ruki-Pass'

// Tabs are data-driven so adding SHA-256 etc. later is a one-line change.
const TABS = [
  { algorithm: 'md5', label: 'MD5', hexLength: 32 },
  { algorithm: 'sha1', label: 'SHA-1', hexLength: 40 },
  { algorithm: 'sha256', label: 'SHA-256', hexLength: 64 },
  // PBKDF2 is salted + iterated, so it uses its own tab component (Pbkdf2Tab),
  // not the plain hex-hash CrackerTab. hexLength is unused for it.
  { algorithm: 'pbkdf2', label: 'PBKDF2', hexLength: 0 },
] as const

type View = 'home' | 'hashpass'

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

type ProjectStatus = {
  phase: string
  message: string
  progress: number
}

// No backend route for this yet — simulated. Swap for a real fetch() later.
async function fetchProjectStatus(): Promise<ProjectStatus> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  return {
    phase: 'Researching',
    message:
      'This project is in the researching process. Please wait to see what is going to happen.',
    progress: 35,
  }
}

function Navbar({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <header className="navbar">
      <button className="brand" onClick={() => setView('home')}>
        Ruki<span className="accent">-Pass</span>
      </button>

      <nav className="nav-links">
        <button
          className={`nav-link ${view === 'home' ? 'active' : ''}`}
          onClick={() => setView('home')}
        >
          Home
        </button>
        <button
          className={`nav-link ${view === 'hashpass' ? 'active' : ''}`}
          onClick={() => setView('hashpass')}
        >
          Hash Pass
        </button>
      </nav>

      <a
        className="nav-gh"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Ruki-Pass on GitHub"
      >
        <GitHubIcon />
        <span>GitHub</span>
      </a>
    </header>
  )
}

function HomeView({ goToHashPass }: { goToHashPass: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['project-status'],
    queryFn: fetchProjectStatus,
  })

  return (
    <section className="hero">
      <span className="badge">
        {isLoading ? 'Loading…' : isError ? 'Offline' : data?.phase}
      </span>

      <h1 className="hero-title">
        Find your <span className="accent">pass</span>.
      </h1>

      <p className="hero-tagline">
        Ruki-Pass helps you recover the password behind a hash. Just find your pass.
      </p>

      <p className="hero-status">
        {isLoading
          ? 'Checking on the research…'
          : isError
            ? 'Could not reach the research feed right now.'
            : data?.message}
      </p>

      {!isLoading && !isError && data && (
        <div className="progress" aria-label={`Research progress: ${data.progress}%`}>
          <div className="progress-bar" style={{ width: `${data.progress}%` }} />
        </div>
      )}

      <div className="hero-actions">
        <button className="primary-btn" onClick={goToHashPass}>
          Open Hash Pass
        </button>
        <a className="ghost-btn" href={ORG_URL} target="_blank" rel="noopener noreferrer">
          <GitHubIcon />
          Contribute
        </a>
      </div>

      <p className="hero-foot">
        Open source, built by the{' '}
        <a href={ORG_URL} target="_blank" rel="noopener noreferrer">
          Ruki
        </a>{' '}
        organization.
      </p>
    </section>
  )
}

function HashPassView() {
  const [activeTab, setActiveTab] = useState<string>(TABS[0].algorithm)
  const tab = TABS.find((t) => t.algorithm === activeTab) ?? TABS[0]

  return (
    <section className="panel">
      <h2 className="panel-title">Hash Pass</h2>
      <p className="panel-subtitle">
        Paste a hash and we'll try to recover the password from our wordlist.
      </p>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.algorithm}
            role="tab"
            aria-selected={activeTab === t.algorithm}
            className={`tab ${activeTab === t.algorithm ? 'active' : ''}`}
            onClick={() => setActiveTab(t.algorithm)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab.algorithm === 'pbkdf2' ? (
        <Pbkdf2Tab key="pbkdf2" />
      ) : (
        <CrackerTab key={tab.algorithm} algorithm={tab.algorithm} hexLength={tab.hexLength} />
      )}
    </section>
  )
}

function App() {
  const [view, setView] = useState<View>('home')

  return (
    <div className="app">
      <Navbar view={view} setView={setView} />

      <main className="content">
        {view === 'home' ? (
          <HomeView goToHashPass={() => setView('hashpass')} />
        ) : (
          <HashPassView />
        )}
      </main>

      <footer className="footer">
        Ruki-Pass · a research project by{' '}
        <a href={ORG_URL} target="_blank" rel="noopener noreferrer">
          Ruki
        </a>{' '}
        · {new Date().getFullYear()}
      </footer>
    </div>
  )
}

export default App
