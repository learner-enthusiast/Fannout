/**
 * Upload state that survives a reload (IndexedDB). Files themselves can't be
 * kept, so after a reload an upload waits for the user to re-select the same
 * file (matched by fingerprint) and continues from its completed parts.
 * Every call is wrapped: private windows / blocked storage just mean no resume.
 */

export type PersistedUpload = {
    id: string
    mediaId: string
    name: string
    filename: string
    size: number
    kind: 'image' | 'video' | 'subtitle' | 'json'
    mimeType: string
    fingerprint: string | null
    partSize: number
    partCount: number
    /** Completed parts: [partNumber, etag]. */
    done: [number, string][]
    postIds: string[]
    createdAt: number
}

const DB_NAME = 'fannout-uploads'
const STORE = 'uploads'
/** Older records are dropped: the server expires abandoned uploads after 24 h. */
const MAX_AGE_MS = 23 * 60 * 60 * 1000

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
    if (opening) return opening
    opening = new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') return resolve(null)
            const request = indexedDB.open(DB_NAME, 1)
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
            }
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => resolve(null)
            request.onblocked = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
    return opening
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    try {
        const db = await open()
        if (!db) return null
        return await new Promise<T | null>((resolve) => {
            const tx = db.transaction(STORE, mode)
            const request = body(tx.objectStore(STORE))
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => resolve(null)
            tx.onabort = () => resolve(null)
        })
    } catch {
        return null
    }
}

export const persistUpload = (record: PersistedUpload) => run('readwrite', (store) => store.put(record)).then(() => undefined)

export const forgetUpload = (id: string) => run('readwrite', (store) => store.delete(id)).then(() => undefined)

export async function loadPersistedUploads(): Promise<PersistedUpload[]> {
    const all = ((await run('readonly', (store) => store.getAll())) ?? []) as PersistedUpload[]
    const fresh = all.filter((record) => Date.now() - record.createdAt < MAX_AGE_MS)
    for (const stale of all.filter((record) => !fresh.includes(record))) void forgetUpload(stale.id)
    return fresh
}
