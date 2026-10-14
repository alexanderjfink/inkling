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
import type { useSync } from '../state/useSync'

const inputClass =
  'w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent'

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

export function Settings({
  syncState,
  events,
}: {
  syncState: ReturnType<typeof useSync>
  events: BlipEvent[]
}) {
  const { report, syncing, sync, serverUrl, saveServerUrl, model } = syncState
  const [draft, setDraft] = useState<string | null>(null)
  const [nudge, setNudge] = useState(false)
  const [nudgeNote, setNudgeNote] = useState<string | null>(null)
  const [swReady, setSwReady] = useState<boolean | null>(null)

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
            className="rounded-full border border-line px-4 py-2 text-xs font-medium disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40"
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

      <Section title="Model">
        <p className="text-xs text-ink-soft">
          {model === null ? (
            'checking…'
          ) : model.configured ? (
            <>
              {model.providerName ?? model.provider} · {model.model}
              <br />
              {model.embeddings
                ? `embeddings: ${model.embedProviderName ?? model.embedProvider} · ${model.embedModel}`
                : 'no embeddings — related blips use topics and links'}
            </>
          ) : (
            <>
              none configured — moves come from the playbook. Choose one on the server with{' '}
              <code>INKLING_PROVIDER</code>.
            </>
          )}
        </p>
        <p className="text-xs text-ink-faint">
          app:{' '}
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
          className="self-start rounded-full border border-line px-4 py-2 text-xs font-medium disabled:opacity-40"
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
          className="self-start rounded-full border border-line px-4 py-2 text-xs font-medium disabled:opacity-40"
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
