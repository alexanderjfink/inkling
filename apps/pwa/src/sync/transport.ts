/** BlobPart/BodyInit want a concretely-typed buffer, so copy into a fresh one. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

import { apiFetch } from '../api'

export interface PeerLog {
  deviceId: string
  size: number
}

/**
 * Moving logs between devices. Only two operations matter — "give me your bytes
 * past offset N" and "append these bytes to my log" — because the log is
 * append-only and events are self-identifying. There is no merge.
 */
export interface SyncTransport {
  readonly baseUrl: string
  health(): Promise<boolean>
  devices(): Promise<PeerLog[]>
  pull(deviceId: string, offset: number): Promise<{ text: string; size: number }>
  push(deviceId: string, bytes: Uint8Array): Promise<{ size: number }>
  hasBlob(hash: string): Promise<boolean>
  getBlob(hash: string): Promise<Uint8Array | null>
  putBlob(hash: string, bytes: Uint8Array): Promise<void>
  /** Publish this device's state digest, and read every device's. */
  putDigest(deviceId: string, digest: string): Promise<void>
  digests(): Promise<Array<{ deviceId: string; digest: string }>>
}

export class HttpTransport implements SyncTransport {
  readonly baseUrl: string
  #timeoutMs: number

  constructor(baseUrl: string, timeoutMs = 10_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.#timeoutMs = timeoutMs
  }

  async #fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
    try {
      return await apiFetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.#fetch('/health')
      return res.ok
    } catch {
      return false
    }
  }

  async devices(): Promise<PeerLog[]> {
    const res = await this.#fetch('/devices')
    if (!res.ok) throw new Error(`devices failed: ${res.status}`)
    const body = (await res.json()) as { devices?: PeerLog[] }
    return body.devices ?? []
  }

  async pull(deviceId: string, offset: number): Promise<{ text: string; size: number }> {
    const res = await this.#fetch(`/logs/${deviceId}?offset=${offset}`)
    if (!res.ok) throw new Error(`pull failed: ${res.status}`)
    const size = Number(res.headers.get('x-log-size') ?? '0')
    return { text: await res.text(), size }
  }

  async push(deviceId: string, bytes: Uint8Array): Promise<{ size: number }> {
    const res = await this.#fetch(`/logs/${deviceId}`, {
      method: 'PUT',
      body: toBuffer(bytes),
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
    if (!res.ok) throw new Error(`push failed: ${res.status}`)
    return (await res.json()) as { size: number }
  }

  async hasBlob(hash: string): Promise<boolean> {
    try {
      const res = await this.#fetch(`/blobs/${hash}`, { method: 'HEAD' })
      return res.ok
    } catch {
      return false
    }
  }

  async getBlob(hash: string): Promise<Uint8Array | null> {
    const res = await this.#fetch(`/blobs/${hash}`)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  }

  async putBlob(hash: string, bytes: Uint8Array): Promise<void> {
    const res = await this.#fetch(`/blobs/${hash}`, { method: 'PUT', body: toBuffer(bytes) })
    if (!res.ok) throw new Error(`blob upload failed: ${res.status}`)
  }

  async putDigest(deviceId: string, digest: string): Promise<void> {
    const res = await this.#fetch(`/digests/${deviceId}`, { method: 'PUT', body: digest })
    if (!res.ok) throw new Error(`digest publish failed: ${res.status}`)
  }

  async digests(): Promise<Array<{ deviceId: string; digest: string }>> {
    const res = await this.#fetch('/digests')
    if (!res.ok) throw new Error(`digests failed: ${res.status}`)
    const body = (await res.json()) as { digests?: Array<{ deviceId: string; digest: string }> }
    return body.digests ?? []
  }
}
