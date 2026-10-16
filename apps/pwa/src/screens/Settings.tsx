import type { Blip, BlipEvent, FeedbackContext, ShareDefault } from '@inkling/domain'
import { validatePassword } from '@inkling/domain'
import { useEffect, useState } from 'react'
import { changeOwnPassword } from '../admin'
import { Admin } from './Admin'
import { APP_BUILD } from '../build'
import type { Auth } from '../state/useAuth'
import type { SocialState } from '../state/useSocial'
import {
  BACKUP_LAST_KEY,
  daysSince,
  downloadBackup,
  downloadMarkdownBackup,
  downloadRejections,
} from '../backup'
import { Feedback, type FeedbackEnv } from '../components/Feedback'
import { PROMOTE_ENABLED } from '../features'
import {
  Field,
  Section,
  buttonClass,
  inputClass,
  primaryButtonClass,
} from '../components/SettingsBits'
import { ButtonLabel } from '../components/Spinner'
import {
  NUDGE_KEY,
  notificationsSupported,
  requestNotificationPermission,
  serviceWorkerStatus,
} from '../pwa'
import { Spike } from '../spike/Spike'
import { formatBytes } from '../storage/hash'
import { storage } from '../state/useInkling'
import type { useServerConfig } from '../state/useServerConfig'
import { diagnoseServer } from '../state/useServerConfig'
import type { useSync } from '../state/useSync'
import type { useTheme } from '../state/useTheme'
import { THEME_CHOICES } from '../theme'

type Tab = 'you' | 'sync' | 'notes' | 'friends' | 'about' | 'admin'

/**
 * The tabs, and which of them are showing.
 *
 * Sync and Notes are hidden for now. Their sections are still below, still gated on the
 * same names, so bringing either back is one line here — and the server address is still
 * reachable at sign-in, which is where it is needed most, so hiding Sync is not a dead end.
 */
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'friends', label: 'Friends' },
  { id: 'about', label: 'About' },
]

/** Added only for an admin, which is what makes the Admin half of the app discoverable. */
const ADMIN_TAB: { id: Tab; label: string } = { id: 'admin', label: 'Admin' }

export function Settings({
  syncState,
  events,
  blips,
  serverConfig,
  theme,
  serverUrl,
  onSaveServerUrl,
  auth,
  onOpenHelp,
  adminServerConfig,
  adminModelStatus,
  onRefreshAdminModel,
  social,
  onOpenFriends,
  feedbackEnv,
  onFeedback,
}: {
  syncState: ReturnType<typeof useSync>
  events: BlipEvent[]
  blips: Blip[]
  serverConfig: ReturnType<typeof useServerConfig>
  theme: ReturnType<typeof useTheme>
  serverUrl: string
  onSaveServerUrl: (url: string) => Promise<void>
  auth: Auth
  onOpenHelp: () => void
  adminServerConfig: ReturnType<typeof useServerConfig>
  adminModelStatus: { baseUrl: string | null; embedBaseUrl: string | null } | null
  onRefreshAdminModel: () => Promise<void>
  social: SocialState
  onOpenFriends: () => void
  feedbackEnv: FeedbackEnv
  onFeedback: (text: string, context: FeedbackContext) => Promise<unknown>
}) {
  const { report, syncing, sync } = syncState
  const { config, saving, save, load, status } = serverConfig
  const diagnosis = diagnoseServer(serverUrl, status)

  const [draft, setDraft] = useState<string | null>(null)
  const [nudge, setNudge] = useState(false)
  const [nudgeNote, setNudgeNote] = useState<string | null>(null)
  const [swReady, setSwReady] = useState<boolean | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [lastBackup, setLastBackup] = useState<Date | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordNote, setPasswordNote] = useState<{ ok: boolean; message: string } | null>(null)

  async function saveOwnPassword() {
    setPasswordNote(null)
    const problem = validatePassword(nextPassword)
    if (problem) {
      setPasswordNote({ ok: false, message: `password: ${problem}` })
      return
    }
    setSavingPassword(true)
    try {
      const result = await changeOwnPassword(serverUrl, currentPassword, nextPassword)
      if (result.ok) {
        setChangingPassword(false)
        setCurrentPassword('')
        setNextPassword('')
        setPasswordNote(null)
      } else {
        setPasswordNote({ ok: false, message: result.error })
      }
    } finally {
      setSavingPassword(false)
    }
  }

  // Read when the last export was, so a stale one can be pointed out rather than
  // silently forgotten — which is how escape hatches fail.
  useEffect(() => {
    void (async () => {
      const raw = await storage().getSetting(BACKUP_LAST_KEY)
      const parsed = raw ? new Date(raw) : null
      setLastBackup(parsed && !Number.isNaN(parsed.getTime()) ? parsed : null)
    })()
  }, [])

  async function takeBackup(kind: 'log' | 'notes') {
    if (kind === 'log') downloadBackup(events)
    else downloadMarkdownBackup(blips)
    const at = new Date()
    setLastBackup(at)
    await storage().setSetting(BACKUP_LAST_KEY, at.toISOString())
  }
  const [savingServer, setSavingServer] = useState(false)
  const [savingNudge, setSavingNudge] = useState(false)
  const [vault, setVault] = useState('')
  const [twaPackage, setTwaPackage] = useState('')
  const [twaFingerprint, setTwaFingerprint] = useState('')
  const [folder, setFolder] = useState('')
  const [socialEnabled, setSocialEnabled] = useState(true)
  const [shareDefault, setShareDefault] = useState<ShareDefault>('friends')
  const [tab, setTab] = useState<Tab>('you')

  useEffect(() => {
    if (!config) return
    // The model fields are not here any more: they belong to the server, and they are on
    // the admin screen.
    setVault(config.vault)
    setFolder(config.folder)
    setSocialEnabled(config.socialEnabled)
    setShareDefault(config.shareDefault)
    setTwaPackage(config.twaPackage ?? '')
    setTwaFingerprint(config.twaFingerprint ?? '')
  }, [config])

  const value = draft ?? serverUrl
  const dirty = draft !== null && draft.trim() !== serverUrl

  useEffect(() => {
    void storage()
      .init()
      .then(async () => setNudge((await storage().getSetting(NUDGE_KEY)) === 'on'))
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setSwReady(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (!cancelled) setSwReady(Boolean(registration?.active))
        })
        .catch(() => {
          if (!cancelled) setSwReady(false)
        })
    }, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  async function applyServerUrl(url: string) {
    setSavingServer(true)
    try {
      await onSaveServerUrl(url)
      await load()
    } finally {
      setSavingServer(false)
    }
  }

  /** Suggestions marked bad, which is the data that can improve them. */
  const badCount = blips.reduce((total, blip) => total + blip.rejections.length, 0)

  async function saveSocial() {
    if (await save({ socialEnabled, shareDefault })) setSaved('social')
  }

  async function saveVault() {
    if (await save({ vault, folder })) setSaved('notes')
  }

  async function saveTwa() {
    if (await save({ twaPackage, twaFingerprint })) setSaved('twa')
  }

  async function toggleNudge() {
    const store = storage()
    setSavingNudge(true)
    try {
      await store.init()
      if (nudge) {
        await store.setSetting(NUDGE_KEY, 'off')
        setNudge(false)
        setNudgeNote(null)
        return
      }
      const permission = await requestNotificationPermission()
      if (permission !== 'granted') {
        setNudgeNote('this browser refused notifications')
        return
      }
      await store.setSetting(NUDGE_KEY, 'on')
      setNudge(true)
      setNudgeNote('on — you will hear from it when something is waiting')
    } finally {
      setSavingNudge(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Tabs, because there is genuinely more than one kind of thing on this screen and a
          single column of twelve sections is a screen you scroll past rather than read. */}
      <div className="flex flex-wrap gap-1.5">
        {[...TABS, ...(auth.user?.role === 'admin' ? [ADMIN_TAB] : [])].map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              tab === entry.id
                ? 'bg-ink font-semibold text-surface'
                : 'border border-line text-ink-soft'
            }`}
          >
            {entry.label}
            {entry.id === 'friends' && social.asks.length > 0 ? (
              <span className="ml-1.5 text-accent">{social.asks.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'you' ? (
        <Section
          title="Account"
          hint={
            auth.accounts
              ? `${auth.user?.username ?? 'signed in'} · ${auth.user?.role ?? ''}`
              : 'This server has no accounts, so there is nothing to sign in to.'
          }
        >
          {auth.accounts && auth.user ? (
            <>
              {changingPassword ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="your current password"
                    autoComplete="current-password"
                    className={inputClass}
                  />
                  <input
                    type="password"
                    value={nextPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                    placeholder="a new password"
                    autoComplete="new-password"
                    className={inputClass}
                  />
                  <p className="text-xs text-ink-faint">
                    Your other devices will be signed out. This one keeps working.
                  </p>
                  {passwordNote ? (
                    <p className={passwordNote.ok ? 'text-xs text-good' : 'text-xs text-warn'}>
                      {passwordNote.message}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setChangingPassword(false)
                        setPasswordNote(null)
                      }}
                      className="quiet text-xs"
                    >
                      cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingPassword}
                      onClick={() => void saveOwnPassword()}
                      className={primaryButtonClass}
                    >
                      <ButtonLabel busy={savingPassword}>
                        {savingPassword ? 'Saving…' : 'Change password'}
                      </ButtonLabel>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setChangingPassword(true)}
                    className={buttonClass}
                  >
                    Change my password
                  </button>
                  <button
                    type="button"
                    onClick={() => void auth.signOut()}
                    className="quiet text-xs underline"
                  >
                    sign out
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-ink-faint">
              Anyone who can reach this server can use it. Set an account by restarting it — the
              first account created becomes the admin.
            </p>
          )}
        </Section>
      ) : null}

      {tab === 'you' ? (
        <Section title="Theme">
          <div className="flex flex-wrap gap-2">
            {THEME_CHOICES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => void theme.setChoice(option.id)}
                className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                  theme.choice === option.id
                    ? 'bg-ink text-surface'
                    : 'border border-line text-ink-soft'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint">
            {theme.choice === 'system'
              ? `Following the system, which is ${theme.resolved} right now.`
              : `${theme.resolved === 'dark' ? 'Dark' : 'Light'}, on this device only.`}
          </p>
        </Section>
      ) : null}

      {tab === 'sync' ? (
        <Section
          title="Server"
          hint="The app keeps your Inklings on this device. The server is what syncs them between devices, and where the model and the vault live."
        >
          <input
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="/api"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void applyServerUrl(value)}
              disabled={!dirty || savingServer}
              className={buttonClass}
            >
              <ButtonLabel busy={savingServer}>Save</ButtonLabel>
            </button>
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing}
              className={primaryButtonClass}
            >
              <ButtonLabel busy={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</ButtonLabel>
            </button>
          </div>

          <p className={`text-xs ${status === 'ok' ? 'text-good' : 'text-warn'}`}>
            {status === 'ok'
              ? `● connected to ${serverUrl}`
              : status === 'loading'
                ? '● checking…'
                : `● cannot reach ${serverUrl}`}
          </p>
          {/* Which build is running on each side. Without this, "I rebuilt and nothing
            changed" is unanswerable: a stale image looks exactly like a fix that did
            not work. */}
          <p className="text-xs text-ink-faint">
            app {APP_BUILD} · server {syncState.model?.build ?? '—'}
          </p>
          {syncState.model?.build && syncState.model.build !== APP_BUILD ? (
            <p className="text-xs text-warn">
              The app and the server are different builds. The app comes from the image, so
              rebuilding and restarting is what brings them back together — and if the app stamp has
              not moved, the build did not pick up new code.
            </p>
          ) : null}
          {diagnosis.detail ? <p className="text-xs text-ink-soft">{diagnosis.detail}</p> : null}

          {status !== 'ok' ? (
            <div className="flex flex-wrap gap-2">
              {diagnosis.suggestions.map((suggestion) => (
                <button
                  key={suggestion.url}
                  type="button"
                  onClick={() => {
                    setDraft(suggestion.url)
                    void applyServerUrl(suggestion.url)
                  }}
                  className={buttonClass}
                >
                  Use {suggestion.label}
                </button>
              ))}
            </div>
          ) : null}

          {report ? (
            <p className={`text-xs ${report.ok ? 'text-ink-soft' : 'text-warn'}`}>
              {report.ok ? (
                <>
                  Synced {new Date(report.at).toLocaleTimeString()} · pushed{' '}
                  {formatBytes(report.pushedBytes)} · {report.addedEvents} new event(s) from{' '}
                  {report.peers} device log(s) · blobs ↑{report.blobsUp} ↓{report.blobsDown}
                  <br />
                  state <code>{report.digest}</code> ·{' '}
                  {report.converged ? (
                    <span className="text-good">in sync with every device</span>
                  ) : (
                    'not yet compared with another device'
                  )}
                </>
              ) : (
                <>Sync failed: {report.error} — everything still works offline.</>
              )}
            </p>
          ) : null}
        </Section>
      ) : null}

      {tab === 'notes' ? (
        <Section
          title="Notes"
          hint={
            saved === 'notes' ? (
              <span className="text-good">saved</span>
            ) : PROMOTE_ENABLED ? (
              'Promoted Inklings are written here, into this folder.'
            ) : (
              'Writing notes into a vault is switched off for now — export a note from any Inkling instead, and this is where they will go when it comes back.'
            )
          }
        >
          {config ? (
            <>
              <Field label="Vault">
                <input
                  value={vault}
                  onChange={(event) => setVault(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
              <Field label="Folder inside the vault">
                <input
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
              <button
                type="button"
                onClick={() => void saveVault()}
                disabled={saving}
                className={primaryButtonClass}
              >
                <ButtonLabel busy={saving}>{saving ? 'Saving…' : 'Save note settings'}</ButtonLabel>
              </button>
            </>
          ) : null}
        </Section>
      ) : null}

      {tab === 'friends' ? (
        <Section title="Friends">
          <p className="text-xs text-ink-faint">
            Let a friend suggest a move when you are stuck, and suggest one for them. On by default,
            because the app is about making moves and a friend is often better at seeing the first
            one than a model is.
          </p>

          <button
            type="button"
            onClick={() => {
              setSocialEnabled((on) => !on)
            }}
            className={`self-start rounded-full px-4 py-2 text-xs font-medium ${
              socialEnabled ? 'bg-accent text-surface' : 'border border-line text-ink-soft'
            }`}
          >
            {socialEnabled ? 'Social features are on' : 'Social features are off'}
          </button>

          {socialEnabled ? (
            <>
              <p className="mt-1 text-xs text-ink-soft">New Inklings start…</p>
              <div className="flex flex-wrap gap-1.5">
                {(['friends', 'private'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setShareDefault(option)}
                    className={`rounded-full px-3 py-1.5 text-[11px] ${
                      shareDefault === option
                        ? 'bg-accent text-surface'
                        : 'border border-line text-ink-soft'
                    }`}
                  >
                    {option === 'friends' ? 'shared with friends' : 'private'}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-ink-faint">
                Every Inkling keeps its own switch, on its card, whichever this is — this only
                decides what they start as.
              </p>
              <button
                type="button"
                onClick={onOpenFriends}
                className="self-start rounded-full border border-line px-4 py-2 text-xs text-ink-soft"
              >
                Friends — add one, or see who asked
              </button>
              {social.asks.length > 0 ? (
                <p className="text-[11px] text-accent">
                  {social.asks.length} friend{social.asks.length === 1 ? '' : 's'} waiting on a move
                  from you
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-ink-faint">
              Nothing is sent or received, and the friends screen is closed. Existing friendships
              are kept, so turning it back on restores them.
            </p>
          )}

          {social.error ? <p className="text-xs text-warn">{social.error}</p> : null}

          <button
            type="button"
            onClick={() => void saveSocial()}
            disabled={saving}
            className={primaryButtonClass}
          >
            <ButtonLabel busy={saving}>
              {saving ? 'Saving…' : saved === 'social' ? 'Saved' : 'Save social settings'}
            </ButtonLabel>
          </button>
        </Section>
      ) : null}

      {/* Last, and only ever rendered for an admin, so a member's settings screen has no
          trace of it rather than a tab that refuses to open. */}
      {tab === 'admin' && auth.user?.role === 'admin' ? (
        <Admin
          serverUrl={serverUrl}
          me={auth.user}
          serverConfig={adminServerConfig}
          modelStatus={adminModelStatus}
          onRefreshModel={onRefreshAdminModel}
        />
      ) : null}

      {tab === 'about' ? (
        <Section title="Feedback">
          <p className="text-xs text-ink-faint">
            What the app gets wrong, or what it is missing. Whatever you were doing is attached to
            it automatically — you can see exactly what before sending.
          </p>
          <Feedback
            env={feedbackEnv}
            screen="settings"
            onSend={onFeedback}
            className="self-start text-xs text-ink-soft"
          />
        </Section>
      ) : null}

      {tab === 'about' ? (
        <Section title="Help">
          <button
            type="button"
            onClick={onOpenHelp}
            className="self-start rounded-full border border-line px-4 py-2 text-xs text-ink-soft"
          >
            What everything does, and how to use it
          </button>
        </Section>
      ) : null}

      {tab === 'about' ? (
        <Section title="App">
          <p className="text-xs text-ink-faint">
            {swReady === null
              ? 'checking…'
              : swReady
                ? 'offline-ready — installable, and it accepts shared links'
                : (serviceWorkerStatus().error ??
                  'no service worker, so it will not install (a secure context is required)')}
          </p>
          {/* Here rather than with the server address, because with the Sync tab hidden this
              is the only place a stale build can be noticed — and a stale build is invisible
              by definition. */}
          <p className="text-xs text-ink-faint">
            app {APP_BUILD} · server {syncState.model?.build ?? '—'}
          </p>
          {syncState.model?.build && syncState.model.build !== APP_BUILD ? (
            <p className="text-xs text-warn">
              the server is running a different build from this app — reload, or rebuild the image
            </p>
          ) : null}
        </Section>
      ) : null}

      {tab === 'you' ? (
        <Section title="Reminders">
          <button
            type="button"
            onClick={() => void toggleNudge()}
            disabled={!notificationsSupported() || savingNudge}
            className={buttonClass}
          >
            <ButtonLabel busy={savingNudge}>
              {nudge ? 'Turn reminders off' : 'Remind me when Inklings are waiting'}
            </ButtonLabel>
          </button>
          <p className="text-xs text-ink-faint">
            {nudgeNote ??
              'A nudge when you open the app with something waiting. The web cannot wake itself, so this cannot arrive at a time you pick.'}
          </p>
        </Section>
      ) : null}

      {tab === 'sync' ? (
        <Section title="Backup">
          <p className="text-xs text-ink-soft">
            {events.length} event{events.length === 1 ? '' : 's'} on this device.{' '}
            {lastBackup === null
              ? 'Never exported from this device.'
              : daysSince(lastBackup) === 0
                ? 'Last exported today.'
                : `Last exported ${daysSince(lastBackup)} day${daysSince(lastBackup) === 1 ? '' : 's'} ago.`}
          </p>
          <p className="text-xs text-ink-faint">
            The log is the JSONL that sync already moves, so any device can re-ingest it. The
            Markdown one is the same data as something you could still read if Inkling were gone.
          </p>
          <button
            type="button"
            onClick={() => void takeBackup('log')}
            disabled={events.length === 0}
            className={buttonClass}
          >
            Download log (JSONL)
          </button>
          <button
            type="button"
            onClick={() => void takeBackup('notes')}
            disabled={blips.length === 0}
            className={buttonClass}
          >
            Download as Markdown
          </button>
          <button
            type="button"
            onClick={() => downloadRejections(blips)}
            disabled={badCount === 0}
            className={buttonClass}
          >
            {badCount === 0
              ? 'No bad suggestions marked yet'
              : `Download ${badCount} bad suggestion${badCount === 1 ? '' : 's'}`}
          </button>
        </Section>
      ) : null}

      {tab === 'sync' ? (
        <Section
          title="Android app (optional)"
          hint={
            saved === 'twa' ? (
              <span className="text-good">saved</span>
            ) : (
              'Only needed for a Trusted Web Activity APK. Without both of these, Android shows a URL bar instead of running it full screen.'
            )
          }
        >
          {config ? (
            <>
              <Field label="Package name">
                <input
                  value={twaPackage}
                  onChange={(event) => setTwaPackage(event.target.value)}
                  placeholder="app.inkling.twa"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
              <Field label="Signing fingerprint (SHA-256)">
                <input
                  value={twaFingerprint}
                  onChange={(event) => setTwaFingerprint(event.target.value)}
                  placeholder="AA:BB:CC:…"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
              <p className="text-xs text-ink-faint">
                Get it from your keystore:{' '}
                <code className="text-[11px]">
                  keytool -list -v -keystore android.keystore -alias inkling
                </code>
                . This server then serves it at{' '}
                <code className="text-[11px]">/.well-known/assetlinks.json</code>, so it cannot
                drift from what you saved here.
              </p>
              <button
                type="button"
                onClick={() => void saveTwa()}
                disabled={saving}
                className={primaryButtonClass}
              >
                <ButtonLabel busy={saving}>{saving ? 'Saving…' : 'Save app settings'}</ButtonLabel>
              </button>
            </>
          ) : null}
        </Section>
      ) : null}

      {tab === 'sync' ? (
        <Section title="Storage">
          <Spike />
        </Section>
      ) : null}
    </div>
  )
}
