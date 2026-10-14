import type { Blip } from '@inkling/domain'
import { useCallback, useState } from 'react'
import { AllBlips } from './components/AllBlips'
import { Capture } from './components/Capture'
import { Desk } from './components/Desk'
import { Feed } from './components/Feed'
import { SyncPanel } from './components/SyncPanel'
import { useInkling } from './state/useInkling'
import { usePromote } from './state/usePromote'
import { useRelated } from './state/useRelated'
import { useSync } from './state/useSync'

type Tab = 'today' | 'capture' | 'desk' | 'all' | 'sync'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'capture', label: 'Capture' },
  { id: 'desk', label: 'Desk' },
  { id: 'all', label: 'All' },
  { id: 'sync', label: 'Sync' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const { ready, blips, actions } = useInkling()
  const syncState = useSync()
  const related = useRelated(blips, syncState.provider, syncState.model?.embeddings ?? false)
  const promoteState = usePromote()

  const onPromote = useCallback(
    (blip: Blip, relatedBlips: Blip[]) =>
      promoteState.promote(blip, relatedBlips, {
        provider: syncState.provider,
        baseUrl: syncState.serverUrl,
        actions,
      }),
    [promoteState, syncState.provider, syncState.serverUrl, actions],
  )

  const active = blips.filter((blip) => !blip.deleted && blip.status === 'active').length
  const pinned = blips.filter((blip) => !blip.deleted && blip.desktopPinned).length

  const syncLabel = syncState.syncing
    ? 'syncing…'
    : syncState.report?.ok
      ? `synced ${new Date(syncState.report.at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : syncState.report
        ? 'offline'
        : 'not synced'

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-4 pb-24">
      <header className="flex items-baseline justify-between pt-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Inkling</h1>
          <p className="text-xs text-zinc-500">Help yourself make progress on your inklings.</p>
        </div>
        <div className="text-right text-xs text-zinc-600">
          <div>{ready ? `${active} active` : 'loading…'}</div>
          <div>{syncLabel}</div>
        </div>
      </header>

      {tab === 'today' ? (
        <Feed
          blips={blips}
          actions={actions}
          provider={syncState.provider}
          related={related}
          onPromote={onPromote}
          promoteResults={promoteState.results}
          promotingId={promoteState.busyId}
        />
      ) : null}
      {tab === 'capture' ? <Capture onCapture={actions.capture} /> : null}
      {tab === 'desk' ? <Desk blips={blips} actions={actions} /> : null}
      {tab === 'all' ? <AllBlips blips={blips} actions={actions} /> : null}
      {tab === 'sync' ? <SyncPanel syncState={syncState} /> : null}

      <nav className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl">
          {TABS.map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setTab(tabDef.id)}
              className={`relative flex-1 py-3 text-xs font-medium transition ${
                tab === tabDef.id ? 'text-zinc-100' : 'text-zinc-500'
              }`}
            >
              {tabDef.label}
              {tabDef.id === 'desk' && pinned > 0 ? (
                <span className="absolute top-1.5 ml-1 rounded-full bg-sky-500 px-1.5 text-[9px] text-zinc-950">
                  {pinned}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
