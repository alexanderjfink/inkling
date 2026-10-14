import type { BlipEvent } from '@inkling/domain'
import { useEffect, useState } from 'react'
import { downloadBackup } from '../backup'
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
import type { useSync } from '../state/useSync'

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

export function Settings({
  syncState,
  events,
  serverConfig,
}: {
  syncState: ReturnType<typeof useSync>
  events: BlipEvent[]
  serverConfig: ReturnType<typeof useServerConfig>
}) {
  const { report, syncing, sync, serverUrl, saveServerUrl } = syncState
  const { config, providers, error, saving, save, loaded } = serverConfig

  const [draft, setDraft] = useState<string | null>(null)
  const [nudge, setNudge] = useState(false)
  const [nudgeNote, setNudgeNote] = useState<string | null>(null)
  const [swReady, setSwReady] = useState<boolean | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  // Editable copies of the server settings.
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [embedProvider, setEmbedProvider] = useState('')
  const [embedModel, setEmbedModel] = useState('')
  const [embedApiKey, setEmbedApiKey] = useState('')
  const [similarity, setSimilarity] = useState('')
  const [vault, setVault] = useState('')
  const [folder, setFolder] = useState('')

  useEffect(() => {
    if (!config) return
    setProvider(config.provider ?? '')
    setModel(config.model ?? '')
    setEmbedProvider(config.embedProvider ?? '')
    setEmbedModel(config.embedModel ?? '')
    setSimilarity(config.embedSimilarity === null ? '' : String(config.embedSimilarity))
    setVault(config.vault)
    setFolder(config.folder)
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

  async function saveModel() {
    const patch: Record<string, string | number | null> = {
      provider,
      model,
      embedProvider,
      embedModel,
      embedSimilarity: similarity.trim() === '' ? null : Number(similarity),
    }
    // Only send a key when one was typed, so an empty box does not erase it.
    if (apiKey.trim()) patch.apiKey = apiKey.trim()
    if (embedApiKey.trim()) patch.embedApiKey = embedApiKey.trim()

    if (await save(patch)) {
      setApiKey('')
      setEmbedApiKey('')
      setSaved('model')
      await syncState.refreshModel()
    }
  }

  async function saveVault() {
    if (await save({ vault, folder })) setSaved('notes')
  }

  async function toggleNudge() {
    const store = storage()
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
  }

  const chatProviders = providers
  const embedProviders = providers.filter((option) => !option.noEmbeddings)

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Section
        title="Sync"
        hint="Logs are append-only, so syncing is a set-union: nothing to merge, no conflicts, replaying is always safe."
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
            onClick={() => void saveServerUrl(value)}
            disabled={!dirty}
            className={buttonClass}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className={primaryButtonClass}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
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
          <p className="text-xs text-ink-faint">
            This server has no settings endpoint. Configure it with environment variables instead.
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

            <Field label="Model">
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={config.model ?? ''}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={inputClass}
              />
            </Field>

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

            <Field label="Embedding model">
              <input
                value={embedModel}
                onChange={(event) => setEmbedModel(event.target.value)}
                placeholder={config.embedModel ?? ''}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={inputClass}
              />
            </Field>

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

            <button
              type="button"
              onClick={() => void saveModel()}
              disabled={saving}
              className={primaryButtonClass}
            >
              {saving ? 'Saving…' : 'Save model settings'}
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
            'Promoted blips are written here, into this folder.'
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
              {saving ? 'Saving…' : 'Save note settings'}
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
          disabled={!notificationsSupported()}
          className={buttonClass}
        >
          {nudge ? 'Turn reminders off' : 'Remind me when blips are waiting'}
        </button>
        <p className="text-xs text-ink-faint">
          {nudgeNote ??
            'A nudge when you open the app with something waiting. The web cannot wake itself, so this cannot arrive at a time you pick.'}
        </p>
      </Section>

      <Section title="Backup">
        <p className="text-xs text-ink-soft">
          {events.length} event{events.length === 1 ? '' : 's'} on this device. The export is the
          JSONL the log already is, so any device can re-ingest it.
        </p>
        <button
          type="button"
          onClick={() => downloadBackup(events)}
          disabled={events.length === 0}
          className={buttonClass}
        >
          Download log
        </button>
      </Section>

      <Section title="Storage">
        <Spike />
      </Section>
    </div>
  )
}
