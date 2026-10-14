import { type Blip, buildDailyFeed } from '@inkling/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AllBlips } from './components/AllBlips'
import { Capture } from './components/Capture'
import { Desk } from './components/Desk'
import { Feed } from './components/Feed'
import { SyncPanel } from './components/SyncPanel'
import { NUDGE_KEY, NUDGE_LAST_KEY, clearSharedQuery, notify, readSharedContent } from './pwa'
import { storage, useInkling } from './state/useInkling'
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
  // Content handed over by the OS share sheet. Read once, at mount.
  const incoming = useMemo(() => readSharedContent(), [])
  const [shared, setShared] = useState(incoming)
  const [tab, setTab] = useState<Tab>(incoming ? 'capture' : 'today')

  const { ready, events, blips, actions } = useInkling()
  const syncState = useSync()
  const related = useRelated(
    blips,
    syncState.provider,
    syncState.model?.embeddings ?? false,
    syncState.model?.embedSimilarity ?? null,
  )
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

  // A shared link should not linger in the URL, or a reload re-captures it.
  useEffect(() => {
    if (incoming) clearSharedQuery()
  }, [incoming])

  // The nudge: one notification a day, and only when something is actually
  // waiting. The web cannot wake itself, so this fires on open rather than at a
  // time you choose — an honest limit, not an oversight.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      const store = storage()
      if ((await store.getSetting(NUDGE_KEY)) !== 'on') return
      const waiting = buildDailyFeed(blips, { now: new Date() }).length
      if (waiting === 0) return
      const today = new Date().toISOString().slice(0, 10)
      if ((await store.getSetting(NUDGE_LAST_KEY)) === today) return
      const shown = await notify(
        `${waiting} inkling${waiting === 1 ? '' : 's'} waiting`,
        'Low-energy moment? They are a couple of minutes each.',
      )
      if (shown && !cancelled) await store.setSetting(NUDGE_LAST_KEY, today)
    })()
    return () => {
      cancelled = true
    }
  }, [ready, blips])

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
      {tab === 'capture' ? (
        <Capture onCapture={actions.capture} initial={shared} onConsumed={() => setShared(null)} />
      ) : null}
      {tab === 'desk' ? <Desk blips={blips} actions={actions} /> : null}
      {tab === 'all' ? <AllBlips blips={blips} actions={actions} /> : null}
      {tab === 'sync' ? <SyncPanel syncState={syncState} events={events} /> : null}

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
