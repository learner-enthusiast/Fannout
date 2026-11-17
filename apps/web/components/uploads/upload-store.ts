import { useSyncExternalStore } from 'react'

import type { UploadItem, UploadStatus } from './upload-provider'

/** Progress ticks reach subscribers at most this often (≤ 5/s). */
const PROGRESS_FLUSH_MS = 200

/** Bytes still have to move (or the file is being read): keep the tab open. */
export const TRANSFER_STATUSES: UploadStatus[] = ['preparing', 'queued', 'uploading', 'paused', 'needs_file']
/** Not finished yet (includes server-side processing). */
export const ACTIVE_STATUSES: UploadStatus[] = [...TRANSFER_STATUSES, 'processing']

type Live = Pick<UploadItem, 'progress' | 'speed' | 'etaSeconds'>

/**
 * External store for upload items. High-frequency state (byte progress,
 * speed) lives here, NOT in React context or page state, so only components
 * that subscribe through a selector (progress rings, the tray) re-render on a tick.
 */
export function createUploadStore() {
    let items: UploadItem[] = []
    const listeners = new Set<() => void>()
    const pending = new Map<string, Live>()
    let timer: ReturnType<typeof setTimeout> | null = null

    const emit = () => listeners.forEach((listener) => listener())

    const applyPending = (current: UploadItem[]) => {
        if (pending.size === 0) return current
        const live = new Map(pending)
        pending.clear()
        return current.map((item) => (live.has(item.id) ? { ...item, ...live.get(item.id)! } : item))
    }

    function flush() {
        if (timer) clearTimeout(timer)
        timer = null
        if (pending.size === 0) return
        items = applyPending(items)
        emit()
    }

    return {
        get: () => items,
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        /** Structural change (status, add, remove). Applies any pending progress first. */
        update(updater: (current: UploadItem[]) => UploadItem[]) {
            if (timer) clearTimeout(timer)
            timer = null
            items = updater(applyPending(items))
            emit()
        },
        /** Progress / speed only, throttled to PROGRESS_FLUSH_MS. */
        setLive(id: string, live: Live) {
            pending.set(id, live)
            if (!timer) timer = setTimeout(flush, PROGRESS_FLUSH_MS)
        },
    }
}

export type UploadStore = ReturnType<typeof createUploadStore>

/** Subscribe to a slice. `select` must return a stable value (primitive or memoized) for equal state. */
export function useUploadSelector<T>(store: UploadStore, select: (items: UploadItem[]) => T): T {
    return useSyncExternalStore(
        store.subscribe,
        () => select(store.get()),
        () => select([])
    )
}

export const selectItems = (items: UploadItem[]) => items
export const selectCount = (items: UploadItem[]) => items.length
export const selectActiveCount = (items: UploadItem[]) => items.filter((item) => ACTIVE_STATUSES.includes(item.status)).length
/** Changes only when an item is added/removed or its status/mediaId changes — never on progress ticks. */
export const selectStructure = (items: UploadItem[]) => items.map((item) => `${item.id}:${item.status}:${item.mediaId ?? ''}`).join(',')
