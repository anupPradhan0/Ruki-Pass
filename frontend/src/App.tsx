import { useQuery } from '@tanstack/react-query'

const ORG_URL = 'https://github.com/Ruki111'
const REPO_URL = 'https://github.com/Ruki111/Ruki-Pass'

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="20"
      height="20"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

type ProjectStatus = {
  phase: string
  message: string
  progress: number
}

// No backend yet — this simulates the call TanStack Query will make
// once the research API is live. Swap this out for a real fetch() later.
async function fetchProjectStatus(): Promise<ProjectStatus> {
  await new Promise((resolve) => setTimeout(resolve, 800))
  return {
    phase: 'Researching',
    message: 'This project is in the researching process. Please wait to see what is going to happen.',
    progress: 35,
  }
}

function App() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['project-status'],
    queryFn: fetchProjectStatus,
  })

  return (
    <main className="page">
      <a
        className="gh-top"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Ruki-Pass on GitHub"
        title="View Ruki-Pass on GitHub"
      >
        <GitHubIcon />
        <span>GitHub</span>
      </a>

      <div className="card">
        <span className="badge">
          {isLoading ? 'Loading…' : isError ? 'Offline' : data?.phase}
        </span>

        <h1>
          Ruki<span className="accent">-Pass</span>
        </h1>

        <p className="tagline">
          This project will help you <strong>find your pass</strong>. Just find your pass.
        </p>

        <p className="status">
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

        <p className="hint">Please wait to see what is going to happen.</p>

        <div className="opensource">
          <p className="opensource-text">
            Open source, built by the{' '}
            <a href={ORG_URL} target="_blank" rel="noopener noreferrer">
              Ruki
            </a>{' '}
            organization. Contributions are welcome.
          </p>
          <a
            className="gh-button"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubIcon />
            <span>Contribute on GitHub</span>
          </a>
        </div>
      </div>

      <footer className="footer">
        Ruki-Pass · a research project by{' '}
        <a href={ORG_URL} target="_blank" rel="noopener noreferrer">
          Ruki
        </a>{' '}
        · {new Date().getFullYear()}
      </footer>
    </main>
  )
}

export default App
