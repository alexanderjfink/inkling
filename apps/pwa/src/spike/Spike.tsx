import { useState } from 'react'
import { formatBytes } from '../storage/hash'

interface BenchResult {
  label: string
  ok: boolean
  detail: string
}

interface OpfsWritable {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
}
interface OpfsFileHandle {
  createWritable(): Promise<OpfsWritable>
}
interface OpfsDir {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>
  removeEntry(name: string): Promise<void>
}
interface StorageManagerExt {
  getDirectory(): Promise<OpfsDir>
  estimate(): Promise<{ usage?: number; quota?: number }>
}

const COUNT = 2000

async function benchIndexedDb(count: number): Promise<BenchResult> {
  const name = 'inkling-spike'
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('e')) {
        req.result.createObjectStore('e', { autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  const start = performance.now()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('e', 'readwrite')
    const store = tx.objectStore('e')
    for (let i = 0; i < count; i++) store.add({ i, text: 'x'.repeat(200) })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  const ms = performance.now() - start

  db.close()
  indexedDB.deleteDatabase(name)
  return {
    label: 'IndexedDB append',
    ok: true,
    detail: `${count} events in ${ms.toFixed(0)} ms · ${(count / (ms / 1000)).toFixed(0)} writes/s`,
  }
}

async function benchOpfs(count: number): Promise<BenchResult> {
  if (!navigator.storage || !('getDirectory' in navigator.storage)) {
    return { label: 'OPFS write', ok: false, detail: 'navigator.storage.getDirectory unavailable' }
  }
  const ext = navigator.storage as unknown as StorageManagerExt
  const root = await ext.getDirectory()
  const handle = await root.getFileHandle('inkling-spike.bin', { create: true })
  const writable = await handle.createWritable()
  const start = performance.now()
  const chunk = new Uint8Array(1024).fill(7)
  for (let i = 0; i < count; i++) await writable.write(chunk)
  await writable.close()
  const ms = performance.now() - start
  await root.removeEntry('inkling-spike.bin').catch(() => undefined)
  return {
    label: 'OPFS append',
    ok: true,
    detail: `${formatBytes(count * 1024)} in ${ms.toFixed(0)} ms · ${(count / (ms / 1000)).toFixed(0)} writes/s`,
  }
}

export function Spike() {
  const [results, setResults] = useState<BenchResult[]>([])
  const [env, setEnv] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    setResults([])
    const out: string[] = [
      `UA: ${navigator.userAgent}`,
      `secure context: ${String(window.isSecureContext)}`,
    ]
    try {
      const estimate = await navigator.storage?.estimate?.()
      if (estimate) {
        out.push(
          `quota: ${formatBytes(estimate.quota ?? 0)} · used ${formatBytes(estimate.usage ?? 0)}`,
        )
      }
    } catch {
      out.push('quota: unavailable')
    }
    setEnv(out)

    const collected: BenchResult[] = []
    for (const bench of [() => benchIndexedDb(COUNT), () => benchOpfs(COUNT)]) {
      try {
        collected.push(await bench())
      } catch (error) {
        collected.push({ label: 'benchmark', ok: false, detail: String(error) })
      }
      setResults([...collected])
    }
    setRunning(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-400">
        Run this <strong className="text-zinc-200">on the Android phone</strong> before we lock the
        storage engine. It measures the two candidate backends for the append-only log.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 disabled:opacity-40"
      >
        {running ? 'Running…' : 'Run storage spike'}
      </button>

      {env.length > 0 ? (
        <pre className="overflow-x-auto rounded-xl border border-zinc-800 p-3 text-xs whitespace-pre-wrap text-zinc-400">
          {env.join('\n')}
        </pre>
      ) : null}

      {results.length > 0 ? (
        <div className="flex flex-col gap-2">
          {results.map((r) => (
            <div
              key={r.label}
              className={`rounded-xl border p-3 text-sm ${r.ok ? 'border-zinc-800' : 'border-amber-900'}`}
            >
              <div className="font-medium text-zinc-200">
                {r.ok ? '✓' : '⚠'} {r.label}
              </div>
              <div className="text-xs text-zinc-400">{r.detail}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
