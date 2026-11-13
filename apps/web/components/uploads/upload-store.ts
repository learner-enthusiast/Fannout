import { useSyncExternalStore } from 'react'

import type { UploadItem, UploadStatus } from './upload-provider'

/** Progress ticks reach subscribers at most this often (≤ 5/s). */
const PROGRESS_FLUSH_MS = 200

export const ACTIVE_STATUSES: UploadStatus[] = ['queued', 'uploading', 'processing']

/**
 * External store for upload items. High-frequency state (byte progress) lives
 * here, NOT in React context, so only components that subscribe through a
 * selector re-render on a tick.
 */
export function createUploadStore() {
    let items: UploadItem[] = []
    const listeners = new Set<() => void>()
    // Progress waiting for the next flush: itemId → 0..1.
    const pendingProgress = new Map<string, number>()
    let timer: ReturnType<typeof setTimeout> | null = null

    const emit = () => listeners.forEach((listener) => listener())

    function flushProgress() {
        if (timer) clearTimeout(timer)
        timer = null
        if (pendingProgress.size === 0) return
        const pending = new Map(pendingProgress)
        pendingProgress.clear()
        items = items.map((item) => (pending.has(item.id) ? { ...item, progress: pending.get(item.id)! } : item))
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
            const pending = new Map(pendingProgress)
            pendingProgress.clear()
            const base = pending.size ? items.map((item) => (pending.has(item.id) ? { ...item, progress: pending.get(item.id)! } : item)) : items
            items = updater(base)
            emit()
        },
        /** Progress-only patch, throttled. */
        setProgress(id: string, progress: number) {
            pendingProgress.set(id, progress)
            if (!timer) timer = setTimeout(flushProgress, PROGRESS_FLUSH_MS)
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
