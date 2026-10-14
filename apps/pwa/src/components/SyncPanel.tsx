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

export function SyncPanel({
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
    // Give registration a moment, then read the recorded outcome.
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

  const value = draft ?? serverUrl
  const dirty = draft !== null && draft.trim() !== serverUrl

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Sync</h2>
        <p className="text-xs text-zinc-500">
          Logs are append-only, so syncing is a set-union: nothing to merge, no conflicts, and
          replaying is always safe.
        </p>
        <label className="mt-1 text-[10px] tracking-wide text-zinc-500 uppercase" htmlFor="server">
          Server
        </label>
        <input
          id="server"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="/api"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void saveServerUrl(value)}
            disabled={!dirty}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        <p className="text-[11px] text-zinc-600">
          <code>/api</code> goes through the dev proxy. For a server elsewhere, use its full URL,
          e.g. <code>https://your-box.tailnet.ts.net</code>.
        </p>
        <p className="text-[11px] text-zinc-500">
          model:{' '}
          {model === null ? (
            'checking…'
          ) : model.configured ? (
            <span className="text-emerald-300">
              {model.providerName ?? model.provider} · {model.model}
              {model.embeddings
                ? ' · embeddings on'
                : ' · no embeddings, so related blips use topics and links'}
            </span>
          ) : (
            <span className="text-zinc-400">
              none configured — moves come from the playbook. Choose a provider on the server with{' '}
              <code>INKLING_PROVIDER</code> (opencode-go, openai, ollama, vllm, …).
            </span>
          )}
        </p>
        <p className="text-[11px] text-zinc-500">
          app:{' '}
          {swReady === null ? (
            'checking…'
          ) : swReady ? (
            <span className="text-emerald-300">
              offline-ready — install it from the browser menu, and share links straight into it
            </span>
          ) : (
            <span className="text-zinc-400">
              no service worker, so it will not install.{' '}
              {serviceWorkerStatus().error ?? 'A secure context is required (HTTPS, or localhost).'}
            </span>
          )}
        </p>
      </section>

      {report ? (
        <section
          className={`rounded-xl border p-3 text-xs ${
            report.ok ? 'border-zinc-800 text-zinc-400' : 'border-amber-900 text-amber-200'
          }`}
        >
          {report.ok ? (
            <>
              <p className="font-medium text-zinc-200">
                Synced {new Date(report.at).toLocaleTimeString()}
              </p>
              <p className="mt-1">
                pushed {formatBytes(report.pushedBytes)} · {report.addedEvents} new event(s) from{' '}
                {report.peers} device log(s) · blobs ↑{report.blobsUp} ↓{report.blobsDown}
              </p>
              <p className="mt-1">
                state <code>{report.digest}</code> ·{' '}
                {report.converged ? (
                  <span className="text-emerald-300">in sync with every device</span>
                ) : (
                  <span className="text-zinc-500">
                    not yet compared with another device — both must sync once
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Sync failed</p>
              <p className="mt-1">{report.error}</p>
              <p className="mt-1 text-amber-300/70">
                Everything still works offline; captures are already on this device.
              </p>
            </>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2 border-t border-zinc-900 pt-5">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Reminders</h2>
        <button
          type="button"
          onClick={() => void toggleNudge()}
          disabled={!notificationsSupported()}
          className="self-start rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
        >
          {nudge ? 'Turn reminders off' : 'Remind me when blips are waiting'}
        </button>
        <p className="text-[11px] text-zinc-600">
          {nudgeNote ??
            'A nudge when you open the app and something is waiting. The web cannot wake itself in the background, so this cannot arrive at a time you pick.'}
        </p>
      </section>

      <section className="flex flex-col gap-2 border-t border-zinc-900 pt-5">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Backup</h2>
        <p className="text-[11px] text-zinc-500">
          {events.length} event{events.length === 1 ? '' : 's'} on this device. The export is the
          same JSONL the log already is, so any device can re-ingest it.
        </p>
        <button
          type="button"
          onClick={() => downloadBackup(events)}
          disabled={events.length === 0}
          className="self-start rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
        >
          Download log
        </button>
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-900 pt-5">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
          Storage diagnostics
        </h2>
        <Spike />
      </section>
    </div>
  )
}
