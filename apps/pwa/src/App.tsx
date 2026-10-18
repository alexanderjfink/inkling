import { type AskContext, type Blip, type Friend, buildDailyFeed } from '@inkling/domain'
import { APP_BUILD } from './build'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeedbackEnv } from './components/Feedback'
import { FriendsButton } from './components/FriendsButton'
import { Spinner } from './components/Spinner'
import { Tour } from './components/Tour'
import { NUDGE_KEY, NUDGE_LAST_KEY, clearSharedQuery, notify, readSharedContent } from './pwa'
import { Add } from './screens/Add'
import { AllBlips } from './screens/AllBlips'
import { CaptureTray } from './components/CaptureTray'
import { SavedTick } from './components/SavedTick'
import { FriendScreen } from './screens/Friend'
import { Friends } from './screens/Friends'
import { Help } from './screens/Help'
import { Notifications } from './screens/Notifications'
import { Review } from './screens/Review'
import { Settings } from './screens/Settings'
import { SignIn } from './screens/SignIn'
import { useAuth } from './state/useAuth'
import { storage, useInkling } from './state/useInkling'
import { usePromote } from './state/usePromote'
import { useRelated } from './state/useRelated'
import { useServerConfig } from './state/useServerConfig'
import { useHiddenWhileReadingDown } from './state/useHiddenWhileReadingDown'
import { useServerUrl } from './state/useServerUrl'
import { useSocial } from './state/useSocial'
import { useSync } from './state/useSync'
import { useTour } from './state/useTour'
import { useTheme } from './state/useTheme'
import { TOUR_KEY, TOUR_STEPS } from './tour'

/** No home screen: the app opens on entry, which is what you came to do. */
type Screen =
  | 'add'
  | 'review'
  | 'all'
  | 'settings'
  | 'you'
  | 'help'
  | 'friends'
  | 'friend'
  | 'notifications'

const TITLES: Record<Screen, string> = {
  add: 'Add an Inkling',
  review: 'Review',
  all: 'All Inklings',
  settings: 'Settings',
  you: 'You',
  help: 'Help',
  friends: 'Friends',
  friend: 'A friend',
  notifications: 'Notifications',
}

export default function App() {
  // Content handed over by the OS share sheet. Read once, at mount.
  const incoming = useMemo(() => readSharedContent(), [])
  const [shared, setShared] = useState(incoming)
  const [screen, setScreen] = useState<Screen>('add')

  /**
   * The back gesture goes back a screen.
   *
   * On Android that gesture is fired at the browser, and without a history entry for each
   * screen it leaves the app entirely — from a card you were reading. The entry screen is the
   * one with nothing behind it, so that is where back leaves.
   */
  /** Where we are, for the pop handler: it must not read a stale closure. */
  const screenRef = useRef(screen)
  screenRef.current = screen

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const wanted = (event.state as { screen?: Screen } | null)?.screen
      // The entry screen is the bottom of the app, so back from it stays here — and that
      // covers a stale entry underneath as well as nothing underneath.
      if (!wanted || screenRef.current === 'add') {
        /**
         * Nothing of ours behind: back was pressed on the entry screen, which is the bottom
         * of the app. It used to leave — from the screen you land on, so the app closed when
         * you meant to dismiss a keyboard. It stays put and puts the guard back, so back from
         * here never does anything at all.
         */
        window.history.pushState({ screen: 'add' }, '')
        setScreen('add')
        setFocusId(null)
        return
      }
      setScreen(wanted)
      setFocusId(null)
    }
    // A screen of our own to stand on, so the first back does not leave the app either.
    window.history.pushState({ screen: 'add' }, '')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((next: Screen) => {
    setScreen((current) => {
      if (current !== next) window.history.pushState({ screen: next }, '')
      return next
    })
  }, [])
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

  /**
   * Signing in puts you on the entry screen, whatever you were looking at when you signed
   * out — and signing out happens *from* the You screen, so that was exactly where you were.
   * Every account gets the same start.
   */
  useEffect(() => {
    if (!auth.user?.id) return
    setScreen('add')
    setFocusId(null)
    window.history.replaceState({ screen: 'add' }, '')
  }, [auth.user?.id])

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

  /**
   * Social is on unless the account has turned it off, and the server says the same thing
   * independently — so a stale app cannot keep asking for something the server refuses.
   */
  const socialOn = serverConfig.config?.socialEnabled !== false
  const social = useSocial({
    serverUrl: server.serverUrl,
    accountId: auth.user?.id ?? null,
    enabled: socialOn,
    actions,
    events,
  })
  /** A friend's shared Inkling chosen from the friends screen, to suggest on unprompted. */
  const [picked, setPicked] = useState<{ friend: Friend; context: AskContext } | null>(null)
  /** Which friend's history is open, by id: a name is not an identity. */
  const [friendId, setFriendId] = useState<string | null>(null)
  /** The tray you catch something in, from anywhere but the entry screen. */
  const [trayOpen, setTrayOpen] = useState(false)
  const readingDown = useHiddenWhileReadingDown()

  const active = blips.filter((blip) => !blip.deleted).length
  const { open: tourOpen, setOpen: setTourOpen } = useTour({
    accountId: auth.user?.id ?? null,
    ready,
    synced: syncState.attempted,
    // Two halves, covering opposite cases, and neither is sufficient.
    //
    // `addedEvents` is the fresh device: the account's Inklings are on the server and
    // arrive during the first sync, but they reach the local projection a beat after the
    // sync reports itself finished — so the count here would still be zero.
    //
    // The local count is the device that already holds them: its sync adds nothing, so
    // `addedEvents` is zero however long the person has been using Inkling.
    hasHistory: active > 0 || (syncState.report?.addedEvents ?? 0) > 0,
  })

  /**
   * The example Inkling arrives with the walkthrough.
   *
   * Not before it: someone who opens the app to write something should find an empty
   * field, not a stranger's keyboard. Once the walkthrough is being offered, an example
   * is the one thing they can safely play with — and it makes the walkthrough's Review
   * step point at a real card rather than describe one that is not there yet.
   *
   * Keyed on the account, because this hook is not remounted by signing out and in as
   * somebody else — the second person needs their own example, and their own store.
   */
  const demoSeededFor = useRef<string | null>(null)
  const accountId = auth.user?.id ?? null
  useEffect(() => {
    if (!tourOpen || !accountId || demoSeededFor.current === accountId) return
    if (blips.some((blip) => blip.demo && !blip.deleted)) return
    demoSeededFor.current = accountId
    void actions.seedDemo()
  }, [tourOpen, accountId, blips, actions])

  /** Finishing or skipping the walkthrough means it does not open by itself again. */
  const dismissTour = useCallback(() => {
    setTourOpen(false)
    void storage().setSetting(TOUR_KEY, 'done')
  }, [setTourOpen])

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

  const feed = useMemo(() => buildDailyFeed(blips, { now: new Date() }), [blips])
  const waiting = feed.length
  /** What the Review card previews: the one you would actually be shown first. */
  const upNext = feed[0] ?? null

  // "Every capture is acknowledged and counted." A capture that vanished silently is
  // the failure this app exists to avoid, so the count is visible rather than assumed.
  const capturedToday = useMemo(() => {
    const today = new Date().toDateString()
    return blips.filter((blip) => !blip.deleted && new Date(blip.created).toDateString() === today)
      .length
  }, [blips])

  /**
   * Everybody waiting on something from you.
   *
   * An ask to answer, or a request to accept — both are somebody having done something that
   * needs a person, which is the only kind of number worth putting on a button.
   */
  const friendsWaiting =
    social.asks.length +
    social.moves.length +
    social.friends.filter((friend) => friend.status === 'asked-of-you').length

  /**
   * What a feedback report needs about the app itself.
   *
   * Built here because it is the one place that already knows all of it, and passed down
   * rather than reached for, so a screen cannot quietly report a stale build.
   */
  const feedbackEnv: FeedbackEnv = {
    app: APP_BUILD,
    server: syncState.model?.build ?? 'unknown',
    provider: syncState.model?.providerName ?? syncState.model?.provider ?? undefined,
    model: syncState.model?.model ?? undefined,
    inklings: active,
    events: events.length,
    today: capturedToday,
  }

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
    /* The Review screen is a fixed height, so the card inside it scrolls and not the page. With
       `min-h-dvh` the column grew to fit its content instead, the page did the scrolling, and the
       card's own scroll position meant nothing — which is why "at the bottom of the card" was true
       the whole time, and reading to the end of an Inkling flipped to the next one. */
    <div
      className={`mx-auto flex max-w-xl flex-col p-4 ${
        screen === 'review' ? 'h-dvh overflow-hidden' : 'min-h-dvh'
      }`}
    >
      {/* The entry screen carries its own header, because it is where you start. */}
      {screen !== 'add' ? (
        <header className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Back"
            className="circle h-10 w-10 text-lg"
          >
            ‹
          </button>
          {/* A friend's screen is about a person, so it says their name. */}
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
            {screen === 'friend'
              ? (social.friends.find((entry) => entry.userId === friendId)?.username ??
                TITLES.friend)
              : TITLES[screen]}
          </h1>
          {socialOn ? (
            <FriendsButton count={friendsWaiting} onClick={() => go('notifications')} />
          ) : null}
        </header>
      ) : null}

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="h-6 w-6 text-ink-faint" />
        </div>
      ) : null}

      {ready && screen === 'add' ? (
        <Add
          onCapture={actions.capture}
          onAddBlock={(id, block) => actions.addBlock(id, block)}
          onStoreImage={actions.storeImage}
          initial={shared}
          onConsumed={() => setShared(null)}
          waiting={waiting}
          next={upNext}
          serverWarning={
            serverConfig.status === 'ok' ||
            serverConfig.status === 'loading' ||
            serverConfig.status === 'signed-out'
              ? null
              : 'the server is not reachable, so sync and the model are off'
          }
          onReview={() => go('review')}
          onSettings={() => go('settings')}
          onYou={() => go('you')}
          userId={auth.user?.id}
          username={auth.user?.username ?? 'you'}
          userColor={auth.user?.color}
          userAvatar={auth.user?.avatar}
          feedbackEnv={feedbackEnv}
          onFeedback={actions.giveFeedback}
          socialOn={socialOn}
          shareDefault={serverConfig.config?.shareDefault ?? 'friends'}
          asking={social.asks}
          onNotifications={() => go('notifications')}
          friendsWaiting={friendsWaiting}
          transcribeUrl={
            serverConfig.config?.transcribeModel ? server.serverUrl.replace(/\/+$/, '') : null
          }
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
          onExit={() => {
            setFocusId(null)
            go('add')
          }}
          onBrowse={() => go('all')}
          onOpenBlip={(id) => setFocusId(id)}
          focusId={focusId}
          serverUrl={syncState.serverUrl}
          feedbackEnv={feedbackEnv}
          onFeedback={actions.giveFeedback}
          social={social}
          socialOn={socialOn}
          fabVisible={!readingDown}
        />
      ) : null}

      {ready && screen === 'all' ? (
        <AllBlips
          blips={blips}
          actions={actions}
          vault={serverConfig.config?.vault ?? ''}
          onOpen={(id) => {
            setFocusId(id)
            go('review')
          }}
        />
      ) : null}
      {ready && screen === 'friends' ? (
        <Friends
          social={social}
          onNotifications={() => go('notifications')}
          onOpen={(friend) => {
            setFriendId(friend.userId)
            go('friend')
          }}
        />
      ) : null}

      {ready && screen === 'friend'
        ? (() => {
            const friend = social.friends.find((entry) => entry.userId === friendId)
            // The friendship can be gone while the screen is open — the other end can end it —
            // so there is nothing to show rather than a screen about nobody.
            if (!friend) {
              return <p className="text-xs text-ink-faint">That is no longer a friendship.</p>
            }
            return (
              <FriendScreen
                friend={friend}
                social={social}
                serverUrl={server.serverUrl}
                events={events}
                blips={blips}
                onOpenBlip={(id) => {
                  setFocusId(id)
                  go('review')
                }}
                onAnswer={() => go('notifications')}
                onUnfriended={() => go('friends')}
              />
            )
          })()
        : null}

      {ready && screen === 'notifications' ? (
        <Notifications
          social={social}
          picked={picked}
          blips={blips}
          events={events}
          serverUrl={server.serverUrl}
          onClearPicked={() => setPicked(null)}
          onOpenFriends={() => go('friends')}
          onOpenBlip={(id) => {
            setFocusId(id)
            go('review')
          }}
        />
      ) : null}

      {ready && screen === 'you' ? (
        <Settings
          syncState={syncState}
          events={events}
          blips={blips}
          serverConfig={serverConfig}
          theme={theme}
          serverUrl={server.serverUrl}
          onSaveServerUrl={server.save}
          auth={auth}
          onOpenHelp={() => go('help')}
          feedbackEnv={feedbackEnv}
          onFeedback={actions.giveFeedback}
          social={social}
          onOpenFriends={() => go('notifications')}
          adminServerConfig={serverConfig}
          adminModelStatus={syncState.model}
          onRefreshAdminModel={syncState.refreshModel}
          only={['you']}
        />
      ) : null}

      {ready && screen === 'help' ? (
        <Help
          onStartTour={() => {
            go('add')
            setTourOpen(true)
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
          onOpenHelp={() => go('help')}
          adminServerConfig={serverConfig}
          adminModelStatus={syncState.model}
          onRefreshAdminModel={syncState.refreshModel}
          feedbackEnv={feedbackEnv}
          onFeedback={actions.giveFeedback}
          social={social}
          onOpenFriends={() => go('notifications')}
          only={['friends', 'about', 'admin']}
        />
      ) : null}

      {/* Not on the entry screen: capture is what that screen is. Everywhere else this is the
          way to notice something without leaving what you were reading. */}
      {screen !== 'add' && !tourOpen ? (
        <button
          type="button"
          onClick={() => setTrayOpen(true)}
          aria-label="Capture a new Inkling"
          /* Out of the way while you are reading down a page, back the moment you scroll up:
             the usual phone behaviour, and the difference between a button that floats over the
             text and one that covers it. */
          className={`fixed bottom-5 left-1/2 z-30 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-2xl text-surface shadow-circle transition-transform duration-200 ${
            readingDown ? 'translate-y-24' : ''
          }`}
        >
          +
        </button>
      ) : null}

      {trayOpen ? (
        <CaptureTray
          onCapture={actions.capture}
          onClose={() => setTrayOpen(false)}
          shareDefault={serverConfig.config?.shareDefault ?? 'friends'}
          socialOn={socialOn}
        />
      ) : null}

      {/* Last, so it sits over whatever screen it is explaining. */}
      {tourOpen ? <Tour steps={TOUR_STEPS} onDone={dismissTour} /> : null}
      {/* And last of all, because it is about what you just did. */}
      <SavedTick />
    </div>
  )
}
