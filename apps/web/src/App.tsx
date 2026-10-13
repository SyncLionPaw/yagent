import { APP_NAME, type AgentConfig } from '@yagent/core'
import { Button } from '@yagent/ui'

const demoAgent: AgentConfig = {
  id: 'demo-1',
  name: 'Demo Agent',
  model: 'kimi',
  createdAt: new Date().toISOString(),
}

function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-6 text-center dark:bg-gray-900">
      <h1 className="text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
        {APP_NAME}
      </h1>
      <p className="max-w-md text-lg text-gray-600 dark:text-gray-300">
        A multi-platform agent workspace. This page is rendered by the Vite + React 19 web app,
        with shared logic from <code className="rounded bg-gray-200 px-1 dark:bg-gray-700">@yagent/core</code>{' '}
        and shared components from{' '}
        <code className="rounded bg-gray-200 px-1 dark:bg-gray-700">@yagent/ui</code>.
      </p>
      <Button onClick={() => alert(`Hello from ${demoAgent.name} (${demoAgent.model})`)}>
        Get started
      </Button>
    </main>
  )
}

export default App
