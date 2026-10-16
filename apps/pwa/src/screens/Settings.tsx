import type { Blip, BlipEvent } from '@inkling/domain'
import { validatePassword } from '@inkling/domain'
import { useEffect, useState } from 'react'
import { changeOwnPassword } from '../admin'
import type { Auth } from '../state/useAuth'
import { BACKUP_LAST_KEY, daysSince, downloadBackup, downloadMarkdownBackup } from '../backup'
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
import { diagnoseServer, useModelTools } from '../state/useServerConfig'
import type { useSync } from '../state/useSync'
import type { useTheme } from '../state/useTheme'
import { THEME_CHOICES } from '../theme'

const inputClass =
  'w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent'
const buttonClass =
  'self-start rounded-full border border-line px-4 py-2 text-xs font-medium disabled:opacity-40'
const primaryButtonClass =
  'self-start rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40'

function Section({
  title,
  children,
  hint,
}: {
  title: string
  children: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-[11px] tracking-wide text-ink-faint uppercase">{title}</h2>
      {children}
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</span>
      {children}
    </label>
  )
}

const CUSTOM = '__custom__'

/**
 * A model field that becomes a real dropdown once the list is known.
 *
 * A `<datalist>` looks like a dropdown in a design tool and behaves like one almost
 * nowhere, especially on a phone. This is an actual `<select>`, with a way back to
 * typing for models the provider does not list — which happens with local runners.
 */
function ModelPicker({
  label,
  value,
  options,
  onChange,
  custom,
  onCustomChange,
  loading,
  onLoad,
  placeholder,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  custom: boolean
  onCustomChange: (custom: boolean) => void
  loading: boolean
  onLoad: () => void
  placeholder: string
}) {
  const listed = value && !options.includes(value) ? [value, ...options] : options

  return (
    <Field label={options.length > 0 ? `${label} · ${options.length} available` : label}>
      {options.length > 0 && !custom ? (
        <select
          value={value}
          onChange={(event) => {
            if (event.target.value === CUSTOM) {
              onCustomChange(true)
              return
            }
            onChange(event.target.value)
          }}
          className={inputClass}
        >
          {value ? null : <option value="">— choose a model —</option>}
          {listed.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
          <option value={CUSTOM}>— type a model that is not listed —</option>
        </select>
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={inputClass}
        />
      )}

      <span className="flex gap-3 text-[11px] text-ink-faint">
        <button
          type="button"
          onClick={onLoad}
          disabled={loading}
          className="underline disabled:opacity-40"
        >
          {loading ? 'loading…' : options.length > 0 ? 'reload the list' : 'load the models'}
        </button>
        {custom && options.length > 0 ? (
          <button type="button" onClick={() => onCustomChange(false)} className="underline">
            back to the list
          </button>
        ) : null}
      </span>
    </Field>
  )
}

export function Settings({
  syncState,
  events,
  blips,
  serverConfig,
  theme,
  serverUrl,
  onSaveServerUrl,
  auth,
  onOpenAdmin,
}: {
  syncState: ReturnType<typeof useSync>
  events: BlipEvent[]
  blips: Blip[]
  serverConfig: ReturnType<typeof useServerConfig>
  theme: ReturnType<typeof useTheme>
  serverUrl: string
  onSaveServerUrl: (url: string) => Promise<void>
  auth: Auth
  onOpenAdmin: () => void
}) {
  const { report, syncing, sync } = syncState
  const { config, providers, error, saving, save, loaded, load, status } = serverConfig
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
  const [chatModels, setChatModels] = useState<string[]>([])
  const [embedModels, setEmbedModels] = useState<string[]>([])
  const [customChat, setCustomChat] = useState(false)
  const [customEmbed, setCustomEmbed] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const modelTools = useModelTools(syncState.serverUrl)

  async function testModel(kind: 'chat' | 'embed') {
    if (!(await persistModel())) return
    const result = await modelTools.testConnection(kind)
    setNote(
      result.ok
        ? {
            ok: true,
            text: `${kind === 'chat' ? 'the model' : 'embeddings'} replied in ${result.ms} ms — ${result.detail ?? ''}`,
          }
        : { ok: false, text: result.error ?? 'the call failed' },
    )
  }

  async function loadModels(kind: 'chat' | 'embed', quiet = false) {
    const result = await modelTools.loadModels(kind)
    if (result.ok && result.models) {
      if (kind === 'chat') setChatModels(result.models)
      else setEmbedModels(result.models)
      if (!quiet) {
        setNote({
          ok: true,
          text:
            result.models.length === 0
              ? 'the provider listed no models'
              : `${result.models.length} models — choose one below`,
        })
      }
    } else if (!quiet) {
      setNote({ ok: false, text: result.error ?? 'could not list models' })
    }
  }

  // Load the list as soon as the screen knows which provider is saved, so a dropdown
  // is simply there rather than something you have to go and ask for.
  const providerKey = `${config?.provider ?? ''}|${config?.embedProvider ?? ''}`
  useEffect(() => {
    if (!config) return
    void loadModels('chat', true)
    if (config.embedProvider) void loadModels('embed', true)
    // loadModels is stable enough; keyed on the saved providers on purpose.
  }, [providerKey])

  // Editable copies of the server settings.
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [embedBaseUrl, setEmbedBaseUrl] = useState('')
  const [embedProvider, setEmbedProvider] = useState('')
  const [embedModel, setEmbedModel] = useState('')
  const [embedApiKey, setEmbedApiKey] = useState('')
  const [similarity, setSimilarity] = useState('')
  const [vault, setVault] = useState('')
  const [twaPackage, setTwaPackage] = useState('')
  const [twaFingerprint, setTwaFingerprint] = useState('')
  const [folder, setFolder] = useState('')

  useEffect(() => {
    if (!config) return
    setProvider(config.provider ?? '')
    setModel(config.model ?? '')
    setEmbedProvider(config.embedProvider ?? '')
    setEmbedModel(config.embedModel ?? '')
    setSimilarity(config.embedSimilarity === null ? '' : String(config.embedSimilarity))
    setBaseUrl(config.baseUrl ?? '')
    setEmbedBaseUrl(config.embedBaseUrl ?? '')
    setVault(config.vault)
    setFolder(config.folder)
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

  /**
   * Save the settings form, before Load or Test get to use it.
   *
   * Both of those read the server's *saved* settings, so pasting a key and pressing Load
   * answered "no model configured" — true, and no help at all. Saving first is what
   * pressing Load was meant to do.
   */
  async function persistModel(): Promise<boolean> {
    const patch: Record<string, string | number | null> = {
      provider,
      model,
      embedProvider,
      embedModel,
      embedSimilarity: similarity.trim() === '' ? null : Number(similarity),
      // An empty address means "use the preset's own", which mergeConfig reads as a
      // request to clear the override.
      baseUrl: baseUrl.trim(),
      embedBaseUrl: embedBaseUrl.trim(),
    }
    // Only send a key when one was typed, so an empty box does not erase it.
    if (apiKey.trim()) patch.apiKey = apiKey.trim()
    if (embedApiKey.trim()) patch.embedApiKey = embedApiKey.trim()

    const ok = await save(patch)
    if (ok) {
      setApiKey('')
      setEmbedApiKey('')
      await syncState.refreshModel()
    }
    return ok
  }

  async function saveModel() {
    if (!(await persistModel())) return
    setSaved('model')
    // A new provider or key means a new list of models. Not quiet: if it fails, the
    // reason is the whole point of having pressed Save.
    void loadModels('chat')
    void loadModels('embed')
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

  const chatProviders = providers
  const embedProviders = providers.filter((option) => !option.noEmbeddings)

  /**
   * Whether an address is worth asking for.
   *
   * True for a preset whose own address is localhost — Ollama, oMLX, vLLM, LM Studio —
   * because a remote one is the ordinary case there, and for a custom endpoint, which
   * has no address of its own at all. False for the hosted providers, where changing
   * the address is a mistake rather than a configuration.
   */
  const addressEditable = (id: string): boolean => {
    if (!id) return false
    const option = providers.find((entry) => entry.id === id)
    if (!option) return false
    if (option.id === 'custom') return true
    return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(option.baseUrl)
  }

  const chatProviderOption = providers.find((entry) => entry.id === provider)
  const embedProviderOption = providers.find((entry) => entry.id === embedProvider)
  const chatAddressEditable = addressEditable(provider)
  const embedAddressEditable = addressEditable(embedProvider)

  return (
    <div className="flex flex-1 flex-col gap-6">
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
                {auth.user.role === 'admin' ? (
                  <button type="button" onClick={onOpenAdmin} className={buttonClass}>
                    Manage accounts
                  </button>
                ) : null}
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
            Anyone who can reach this server can use it. Set an account by restarting it — the first
            account created becomes the admin.
          </p>
        )}
      </Section>

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

      <Section
        title="Model"
        hint={
          error ? (
            <span className="text-warn">{error}</span>
          ) : saved === 'model' ? (
            <span className="text-good">saved</span>
          ) : (
            'Saved settings override the server environment. Keys are written, never read back.'
          )
        }
      >
        {!loaded ? (
          <p className="text-xs text-ink-faint">loading…</p>
        ) : config === null ? (
          <p className="text-xs text-warn">
            The model settings live on the server, and it is not reachable from here. Fix the server
            connection at the top of this screen, then come back.
          </p>
        ) : (
          <>
            <Field label="Provider">
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className={inputClass}
              >
                <option value="">— server default —</option>
                {chatProviders.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>

            {/* Shown when the preset's own address is localhost, or when there is no
                preset at all — the two cases where pointing somewhere else is the
                normal thing rather than a mistake. A remote Ollama lives here. */}
            {chatAddressEditable ? (
              <Field label="Model server address">
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={chatProviderOption?.baseUrl || 'https://example.com/v1'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
                <p className="text-xs text-ink-faint">
                  {chatProviderOption?.baseUrl
                    ? `Leave empty for ${chatProviderOption.baseUrl}`
                    : 'The full base URL, including /v1 if the server uses it.'}
                </p>
              </Field>
            ) : null}

            <ModelPicker
              label="Model"
              value={model}
              options={chatModels}
              onChange={setModel}
              custom={customChat}
              onCustomChange={setCustomChat}
              loading={modelTools.listing === 'chat'}
              onLoad={() =>
                void persistModel().then((ok) => {
                  if (ok) void loadModels('chat')
                })
              }
              placeholder={config.model ?? ''}
            />

            <Field label={`API key ${config.apiKeySet ? '(set)' : '(not set)'}`}>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                placeholder={config.apiKeySet ? 'type to replace' : 'paste a key'}
                autoComplete="off"
                className={inputClass}
              />
            </Field>

            <Field label="Embedding provider">
              <select
                value={embedProvider}
                onChange={(event) => setEmbedProvider(event.target.value)}
                className={inputClass}
              >
                <option value="">— none, or the chat provider —</option>
                {embedProviders.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>

            {embedAddressEditable ? (
              <Field label="Embedding server address">
                <input
                  value={embedBaseUrl}
                  onChange={(event) => setEmbedBaseUrl(event.target.value)}
                  placeholder={embedProviderOption?.baseUrl || 'https://example.com/v1'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
                <p className="text-xs text-ink-faint">
                  {embedProviderOption?.baseUrl
                    ? `Leave empty for ${embedProviderOption.baseUrl}`
                    : 'The full base URL, including /v1 if the server uses it.'}
                </p>
              </Field>
            ) : null}

            <ModelPicker
              label="Embedding model"
              value={embedModel}
              options={embedModels}
              onChange={setEmbedModel}
              custom={customEmbed}
              onCustomChange={setCustomEmbed}
              loading={modelTools.listing === 'embed'}
              onLoad={() =>
                void persistModel().then((ok) => {
                  if (ok) void loadModels('embed')
                })
              }
              placeholder={config.embedModel ?? ''}
            />

            <Field label={`Embedding key ${config.embedApiKeySet ? '(set)' : '(not set)'}`}>
              <input
                value={embedApiKey}
                onChange={(event) => setEmbedApiKey(event.target.value)}
                type="password"
                placeholder={config.embedApiKeySet ? 'type to replace' : 'paste a key'}
                autoComplete="off"
                className={inputClass}
              />
            </Field>

            <Field label="Similarity floor (0–1)">
              <input
                value={similarity}
                onChange={(event) => setSimilarity(event.target.value)}
                inputMode="decimal"
                placeholder={config.embedSimilarity === null ? '0.75 default' : ''}
                className={inputClass}
              />
            </Field>

            <p className="text-xs text-ink-soft">
              in use now: {config.configured ? `${config.providerName} · ${config.model}` : 'none'}
              {config.embeddings
                ? ` · embeddings via ${config.embedProviderName ?? '?'}`
                : ' · no embeddings'}
            </p>
            {/* The address the server will actually call. It is the thing that is wrong
                when a self-hosted model does not answer, and it used to be invisible. */}
            {syncState.model?.baseUrl ? (
              <p className="text-xs text-ink-faint">
                calling {syncState.model.baseUrl}
                {syncState.model.embedBaseUrl &&
                syncState.model.embedBaseUrl !== syncState.model.baseUrl
                  ? ` · embeddings at ${syncState.model.embedBaseUrl}`
                  : ''}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  void persistModel().then((ok) => {
                    if (ok) void loadModels('chat')
                  })
                }
                disabled={modelTools.listing !== null}
                className={buttonClass}
              >
                <ButtonLabel busy={modelTools.listing === 'chat'}>
                  {modelTools.listing === 'chat' ? 'Loading…' : 'Load models'}
                </ButtonLabel>
              </button>
              <button
                type="button"
                onClick={() => void testModel('chat')}
                disabled={modelTools.testing !== null}
                className={buttonClass}
              >
                <ButtonLabel busy={modelTools.testing === 'chat'}>
                  {modelTools.testing === 'chat' ? 'Testing…' : 'Test model'}
                </ButtonLabel>
              </button>
              <button
                type="button"
                onClick={() =>
                  void persistModel().then((ok) => {
                    if (ok) void loadModels('embed')
                  })
                }
                disabled={modelTools.listing !== null}
                className={buttonClass}
              >
                <ButtonLabel busy={modelTools.listing === 'embed'}>
                  {modelTools.listing === 'embed' ? 'Loading…' : 'Load embedding models'}
                </ButtonLabel>
              </button>
              <button
                type="button"
                onClick={() => void testModel('embed')}
                disabled={modelTools.testing !== null}
                className={buttonClass}
              >
                <ButtonLabel busy={modelTools.testing === 'embed'}>
                  {modelTools.testing === 'embed' ? 'Testing…' : 'Test embeddings'}
                </ButtonLabel>
              </button>
            </div>

            {note ? (
              <p className={`text-xs ${note.ok ? 'text-good' : 'text-warn'}`}>{note.text}</p>
            ) : (
              <p className="text-xs text-ink-faint">
                Load and Test save your changes first, then act on them.
              </p>
            )}

            <button
              type="button"
              onClick={() => void saveModel()}
              disabled={saving}
              className={primaryButtonClass}
            >
              <ButtonLabel busy={saving}>{saving ? 'Saving…' : 'Save model settings'}</ButtonLabel>
            </button>
          </>
        )}
      </Section>

      <Section
        title="Notes"
        hint={
          saved === 'notes' ? (
            <span className="text-good">saved</span>
          ) : (
            'Promoted Inklings are written here, into this folder.'
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

      <Section title="App">
        <p className="text-xs text-ink-faint">
          {swReady === null
            ? 'checking…'
            : swReady
              ? 'offline-ready — installable, and it accepts shared links'
              : (serviceWorkerStatus().error ??
                'no service worker, so it will not install (a secure context is required)')}
        </p>
      </Section>

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
          The log is the JSONL that sync already moves, so any device can re-ingest it. The Markdown
          one is the same data as something you could still read if Inkling were gone.
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
      </Section>

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
              <code className="text-[11px]">/.well-known/assetlinks.json</code>, so it cannot drift
              from what you saved here.
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

      <Section title="Storage">
        <Spike />
      </Section>
    </div>
  )
}
