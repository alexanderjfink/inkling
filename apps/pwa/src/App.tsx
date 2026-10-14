import { useState } from 'react'
import { AllBlips } from './components/AllBlips'
import { Capture } from './components/Capture'
import { Feed } from './components/Feed'
import { Spike } from './spike/Spike'
import { useInkling } from './state/useInkling'

type Tab = 'today' | 'capture' | 'all' | 'spike'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'capture', label: 'Capture' },
  { id: 'all', label: 'All' },
  { id: 'spike', label: 'Spike' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const { ready, blips, actions } = useInkling()
  const active = blips.filter((b) => !b.deleted && b.status === 'active').length

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-4 pb-24">
      <header className="flex items-baseline justify-between pt-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Inkling</h1>
          <p className="text-xs text-zinc-500">Help yourself make progress on your inklings.</p>
        </div>
        <span className="text-xs text-zinc-600">{ready ? `${active} active` : 'loading…'}</span>
      </header>

      {tab === 'today' ? <Feed blips={blips} actions={actions} /> : null}
      {tab === 'capture' ? <Capture onCapture={actions.capture} /> : null}
      {tab === 'all' ? <AllBlips blips={blips} actions={actions} /> : null}
      {tab === 'spike' ? <Spike /> : null}

      <nav className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl">
          {TABS.map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setTab(tabDef.id)}
              className={`flex-1 py-3 text-xs font-medium transition ${
                tab === tabDef.id ? 'text-zinc-100' : 'text-zinc-500'
              }`}
            >
              {tabDef.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
