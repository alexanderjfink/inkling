import { type Blip, buildDailyFeed } from '@inkling/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NUDGE_KEY, NUDGE_LAST_KEY, clearSharedQuery, notify, readSharedContent } from './pwa'
import { Add } from './screens/Add'
import { AllBlips } from './screens/AllBlips'
import { Home } from './screens/Home'
import { Review } from './screens/Review'
import { Settings } from './screens/Settings'
import { storage, useInkling } from './state/useInkling'
import { usePromote } from './state/usePromote'
import { useRelated } from './state/useRelated'
import { useSync } from './state/useSync'

type Screen = 'home' | 'add' | 'review' | 'all' | 'settings'

const TITLES: Record<Screen, string> = {
  home: 'Inkling',
  add: 'Add a blip',
  review: 'Review',
  all: 'All blips',
  settings: 'Settings',
}

export default function App() {
  // Content handed over by the OS share sheet. Read once, at mount.
  const incoming = useMemo(() => readSharedContent(), [])
  const [shared, setShared] = useState(incoming)
  const [screen, setScreen] = useState<Screen>(incoming ? 'add' : 'home')

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

  // The nudge: once a day, and only when something is actually waiting. The web
  // cannot wake itself, so this fires on open rather than at a time you choose.
  useEffect(() => {
    if (!ready) return
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
      if (shown) await store.setSetting(NUDGE_LAST_KEY, today)
    })()
  }, [ready, blips])

  const waiting = useMemo(() => buildDailyFeed(blips, { now: new Date() }).length, [blips])
  const attic = blips.filter((blip) => !blip.deleted && blip.status === 'retired').length

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col p-4">
      {screen !== 'home' ? (
        <header className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setScreen('home')}
            aria-label="Back"
            className="circle h-10 w-10 text-lg"
          >
            ‹
          </button>
          <h1 className="text-base font-semibold">{TITLES[screen]}</h1>
        </header>
      ) : null}

      {screen === 'home' ? (
        <Home
          waiting={waiting}
          attic={attic}
          onAdd={() => setScreen('add')}
          onReview={() => setScreen('review')}
          onAttic={() => setScreen('all')}
          onSettings={() => setScreen('settings')}
        />
      ) : null}

      {screen === 'add' ? (
        <Add
          onCapture={actions.capture}
          initial={shared}
          onConsumed={() => setShared(null)}
          onDone={() => setScreen('home')}
        />
      ) : null}

      {screen === 'review' ? (
        <Review
          blips={blips}
          actions={actions}
          provider={syncState.provider}
          related={related}
          onPromote={onPromote}
          promoteResults={promoteState.results}
          promotingId={promoteState.busyId}
          onExit={() => setScreen('home')}
        />
      ) : null}

      {screen === 'all' ? <AllBlips blips={blips} actions={actions} /> : null}
      {screen === 'settings' ? <Settings syncState={syncState} events={events} /> : null}
    </div>
  )
}
