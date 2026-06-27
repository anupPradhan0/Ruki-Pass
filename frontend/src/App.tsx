import { useQuery } from '@tanstack/react-query'

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
      </div>

      <footer className="footer">
        Ruki-Pass · a research project · {new Date().getFullYear()}
      </footer>
    </main>
  )
}

export default App
