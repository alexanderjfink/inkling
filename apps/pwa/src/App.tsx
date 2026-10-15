import { type Blip, buildDailyFeed } from '@inkling/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from './components/Spinner'
import { NUDGE_KEY, NUDGE_LAST_KEY, clearSharedQuery, notify, readSharedContent } from './pwa'
import { Add } from './screens/Add'
import { Admin } from './screens/Admin'
import { AllBlips } from './screens/AllBlips'
import { Home } from './screens/Home'
import { Review } from './screens/Review'
import { Settings } from './screens/Settings'
import { SignIn } from './screens/SignIn'
import { useAuth } from './state/useAuth'
import { storage, useInkling } from './state/useInkling'
import { usePromote } from './state/usePromote'
import { useRelated } from './state/useRelated'
import { useServerConfig } from './state/useServerConfig'
import { useServerUrl } from './state/useServerUrl'
import { useSync } from './state/useSync'
import { useTheme } from './state/useTheme'

type Screen = 'home' | 'add' | 'review' | 'all' | 'settings' | 'admin'

const TITLES: Record<Screen, string> = {
  home: 'Inkling',
  add: 'Add an Inkling',
  review: 'Review',
  all: 'All Inklings',
  settings: 'Settings',
  admin: 'Accounts',
}

export default function App() {
  // Content handed over by the OS share sheet. Read once, at mount.
  const incoming = useMemo(() => readSharedContent(), [])
  const [shared, setShared] = useState(incoming)
  const [screen, setScreen] = useState<Screen>(incoming ? 'add' : 'home')
  /** A blip chosen from the list, to open straight away in Review. */
  const [focusId, setFocusId] = useState<string | null>(null)

  const server = useServerUrl()
  const auth = useAuth(server.serverUrl)

  /**
   * Declared before sync on purpose.
   *
   * Selecting the account's store is a synchronous side effect of this hook, and sync
   * reads `storage()`. With the order reversed, the first sync after signing in would
   * run against the previous account's database — which looked exactly like "the server
   * has none of my Inklings".
   */
  const { ready, events, blips, actions } = useInkling(auth.user?.id ?? null)

  /** Sync waits for a session: before signing in every request would be a 401. */
  const signedIn = auth.ready && (!auth.accounts || !auth.signedOut)
  const syncState = useSync({
    serverUrl: server.serverUrl,
    enabled: signedIn,
    accountId: auth.user?.id ?? null,
  })
  const related = useRelated(
    blips,
    syncState.provider,
    syncState.model?.embeddings ?? false,
    syncState.model?.embedSimilarity ?? null,
  )
  const promoteState = usePromote()
  const serverConfig = useServerConfig(server.serverUrl, auth.user?.id ?? null)
  const theme = useTheme()

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
  const attic = blips.filter(
    (blip) => !blip.deleted && (blip.status === 'retired' || blip.status === 'promoted'),
  ).length

  // "Every capture is acknowledged and counted." A capture that vanished silently is
  // the failure this app exists to avoid, so the count is visible rather than assumed.
  const capturedToday = useMemo(() => {
    const today = new Date().toDateString()
    return blips.filter((blip) => !blip.deleted && new Date(blip.created).toDateString() === today)
      .length
  }, [blips])

  // Signing in comes before everything: until we know who you are, there is no store
  // to open and no Inklings to show.
  if (!server.loaded || !auth.ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-6 w-6 text-ink-faint" />
      </div>
    )
  }

  if (auth.accounts && auth.signedOut) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col p-4">
        <SignIn
          auth={auth}
          serverUrl={server.serverUrl}
          onSaveServerUrl={server.save}
          reachable={auth.state?.reachable ?? true}
        />
      </div>
    )
  }

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

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="h-6 w-6 text-ink-faint" />
        </div>
      ) : null}

      {ready && screen === 'home' ? (
        <Home
          waiting={waiting}
          total={blips.filter((blip) => !blip.deleted).length}
          attic={attic}
          capturedToday={capturedToday}
          serverWarning={
            serverConfig.status === 'ok' ||
            serverConfig.status === 'loading' ||
            serverConfig.status === 'signed-out'
              ? null
              : 'the server is not reachable, so sync and the model are off'
          }
          onAdd={() => setScreen('add')}
          onReview={() => setScreen('review')}
          onAttic={() => setScreen('all')}
          onSettings={() => setScreen('settings')}
        />
      ) : null}

      {ready && screen === 'admin' && auth.user ? (
        <Admin serverUrl={server.serverUrl} me={auth.user} />
      ) : null}

      {ready && screen === 'add' ? (
        <Add
          onCapture={actions.capture}
          initial={shared}
          onConsumed={() => setShared(null)}
          onDone={() => setScreen('home')}
        />
      ) : null}

      {ready && screen === 'review' ? (
        <Review
          blips={blips}
          actions={actions}
          provider={syncState.provider}
          related={related}
          onPromote={onPromote}
          promoteResults={promoteState.results}
          promotingId={promoteState.busyId}
          onExit={() => {
            setFocusId(null)
            setScreen('home')
          }}
          onBrowse={() => setScreen('all')}
          onOpenBlip={(id) => setFocusId(id)}
          focusId={focusId}
          serverUrl={syncState.serverUrl}
        />
      ) : null}

      {ready && screen === 'all' ? (
        <AllBlips
          blips={blips}
          actions={actions}
          vault={serverConfig.config?.vault ?? ''}
          onOpen={(id) => {
            setFocusId(id)
            setScreen('review')
          }}
        />
      ) : null}
      {ready && screen === 'settings' ? (
        <Settings
          syncState={syncState}
          events={events}
          blips={blips}
          serverConfig={serverConfig}
          theme={theme}
          serverUrl={server.serverUrl}
          onSaveServerUrl={server.save}
          auth={auth}
          onOpenAdmin={() => setScreen('admin')}
        />
      ) : null}
    </div>
  )
}
