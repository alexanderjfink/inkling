/** Minimal promise helpers over IndexedDB — no dependencies. */

export type Durability = 'strict' | 'relaxed' | 'default'

export function openDatabase(
  name: string,
  version: number,
  onUpgrade: (db: IDBDatabase, transaction: IDBTransaction | null) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => onUpgrade(request.result, request.transaction)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`IndexedDB upgrade blocked for ${name}`))
  })
}

/**
 * Run `fn` inside a single transaction and resolve when the transaction commits.
 *
 * `durability: 'strict'` asks the browser to flush before reporting success, so a
 * committed capture survives a power loss. That matters more than throughput for
 * an append-only log people are meant to trust; the default is relaxed.
 */
export function runTransaction<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => T,
  durability?: Durability,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = durability
      ? db.transaction(stores, mode, { durability })
      : db.transaction(stores, mode)
    let result: T
    try {
      result = fn(tx)
    } catch (error) {
      reject(error)
      return
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
