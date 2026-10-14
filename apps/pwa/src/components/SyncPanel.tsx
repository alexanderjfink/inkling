import { useState } from 'react'
import { Spike } from '../spike/Spike'
import { formatBytes } from '../storage/hash'
import type { useSync } from '../state/useSync'

export function SyncPanel({ syncState }: { syncState: ReturnType<typeof useSync> }) {
  const { report, syncing, sync, serverUrl, saveServerUrl, model } = syncState
  const [draft, setDraft] = useState<string | null>(null)

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

      <section className="flex flex-col gap-3 border-t border-zinc-900 pt-5">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
          Storage diagnostics
        </h2>
        <Spike />
      </section>
    </div>
  )
}
