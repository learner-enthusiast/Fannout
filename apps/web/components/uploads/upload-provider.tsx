'use client'

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react'
import { toast } from 'sonner'

import { formatBytes, mediaKind, type UploadKind } from '~/lib/media-format'
import { trpc } from '~/trpc/client'

import {
    ACTIVE_STATUSES,
    createUploadStore,
    selectActiveCount,
    selectCount,
    selectItems,
    selectStructure,
    useUploadSelector,
    type UploadStore,
} from './upload-store'

/**
 * Background uploads. Mounted once in the (app) layout so uploads keep going
 * across route changes. Files go straight to S3 as multipart uploads
 * (presigned part URLs); the API is only told to start, complete or fail.
 *
 * - at most 2 files at a time, 3 parts per file in parallel
 * - each part is retried 3× with exponential backoff
 * - after completion the item shows "processing" until the API reports
 *   ready/failed (Inngest probes the file)
 */

export type UploadStatus =
    | 'queued'
    | 'uploading'
    | 'processing'
    | 'ready'
    | 'failed'
    | 'cancelled'

export type UploadItem = {
    id: string
    name: string
    size: number
    kind: UploadKind
    status: UploadStatus
    /** 0..1 of bytes sent to storage. */
    progress: number
    mediaId?: string
    error?: string
}

export type EnqueueOptions = {
    /** Runs once the media is processed and ready (e.g. auto-link a thumbnail). */
    onReady?: (mediaId: string) => void | Promise<void>
}

/**
 * The context value is STABLE (store + memoized actions). Progress is never in
 * context: read it through useUploadItems / useUploadActiveCount / useUploadCount.
 */
type UploadContextValue = {
    store: UploadStore
    /** Files (or { file, name } for a custom display name) join the queue. */
    enqueue: (files: (File | UploadEntry)[], options?: EnqueueOptions) => void
    cancel: (id: string) => void
    dismiss: (id: string) => void
    clearFinished: () => void
}

export type UploadEntry = { file: File; name?: string }

const UploadContext = createContext<UploadContextValue | null>(null)

const MAX_FILES = 2
const PARTS_IN_PARALLEL = 3
const PART_RETRIES = 3
const POLL_MS = 3000
const POLL_GIVE_UP_MS = 15 * 60 * 1000

const IN_FLIGHT: UploadStatus[] = ['queued', 'uploading']
const ACTIVE = ACTIVE_STATUSES

class FatalUploadError extends Error {}

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer)
                reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true }
        )
    })
}

/** PUT one part; resolves with its ETag. Progress reports bytes sent. */
function putPart(
    url: string,
    body: Blob,
    signal: AbortSignal,
    onProgress: (loaded: number) => void
): Promise<string> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', url)
        xhr.upload.onprogress = (event) => onProgress(event.loaded)
        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                const error = new Error(`Storage responded ${xhr.status}`)
                // 4xx other than timeout/rate limit won't fix itself.
                if (xhr.status >= 400 && xhr.status < 500 && ![408, 429].includes(xhr.status))
                    return reject(new FatalUploadError(error.message))
                return reject(error)
            }
            const etag = xhr.getResponseHeader('ETag')
            if (!etag)
                return reject(
                    new FatalUploadError(
                        'Storage did not return an ETag (bucket CORS must expose the ETag header)'
                    )
                )
            onProgress(body.size)
            resolve(etag)
        }
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.ontimeout = () => reject(new Error('Timed out'))
        const abort = () => xhr.abort()
        signal.addEventListener('abort', abort, { once: true })
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
        xhr.send(body)
    })
}

async function withRetry<T>(
    signal: AbortSignal,
    attempt: () => Promise<T>
): Promise<T> {
    for (let tries = 0; ; tries += 1) {
        try {
            return await attempt()
        } catch (error) {
            if (signal.aborted || error instanceof FatalUploadError || tries >= PART_RETRIES)
                throw error
            await sleep(500 * 2 ** tries + Math.random() * 250, signal)
        }
    }
}

/** Runs `worker` over items with at most `limit` in flight; stops on first error. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    let next = 0
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++]!
            await worker(item)
        }
    })
    await Promise.all(lanes)
}

function errorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message.slice(0, 300)
    return 'Upload failed'
}

export function UploadProvider({ children }: { children: ReactNode }) {
    const utils = trpc.useUtils()
    const [store] = useState(createUploadStore)
    const files = useRef(new Map<string, { file: File; name?: string; mimeType: string }>())
    const options = useRef(new Map<string, EnqueueOptions>())
    const controllers = useRef(new Map<string, AbortController>())
    const started = useRef(new Set<string>())
    const processingSince = useRef(new Map<string, number>())

    const patch = useCallback(
        (id: string, update: Partial<UploadItem>) => {
            store.update((current) =>
                current.map((item) => (item.id === id ? { ...item, ...update } : item))
            )
        },
        [store]
    )

    const afterFinish = useCallback(() => {
        void utils.media.list.invalidate()
        void utils.notifications.unreadCount.invalidate()
        void utils.notifications.list.invalidate()
    }, [utils])

    const failOnServer = useCallback(
        (mediaId: string, error: string) =>
            utils.client.media.failUpload
                .mutate({ mediaId, error })
                .then(() => afterFinish())
                .catch(() => undefined),
        [utils, afterFinish]
    )

    const upload = useCallback(
        async (item: UploadItem) => {
            const entry = files.current.get(item.id)
            if (!entry) return
            const { file } = entry
            const controller = new AbortController()
            controllers.current.set(item.id, controller)
            const { signal } = controller
            let mediaId: string | undefined

            try {
                const created = await utils.client.media.createUpload.mutate({
                    filename: file.name,
                    mimeType: entry.mimeType,
                    sizeBytes: file.size,
                    ...(entry.name ? { name: entry.name } : {}),
                })
                mediaId = created.mediaId
                patch(item.id, { mediaId })
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

                const loaded = new Array<number>(created.parts.length).fill(0)
                const etags: { partNumber: number; etag: string }[] = []
                let lastReport = 0

                await runPool(created.parts, PARTS_IN_PARALLEL, async (part) => {
                    const start = (part.partNumber - 1) * created.partSize
                    const blob = file.slice(start, start + created.partSize)
                    const etag = await withRetry(signal, () =>
                        putPart(part.url, blob, signal, (bytes) => {
                            loaded[part.partNumber - 1] = bytes
                            const now = Date.now()
                            if (now - lastReport > 200) {
                                lastReport = now
                                const sent = loaded.reduce((a, b) => a + b, 0)
                                store.setProgress(item.id, Math.min(0.99, sent / file.size))
                            }
                        })
                    )
                    etags.push({ partNumber: part.partNumber, etag })
                })

                await utils.client.media.completeUpload.mutate({ mediaId, parts: etags })
                processingSince.current.set(item.id, Date.now())
                patch(item.id, { status: 'processing', progress: 1 })
                void utils.media.list.invalidate()
            } catch (error) {
                if (signal.aborted) {
                    if (mediaId) void failOnServer(mediaId, 'Cancelled')
                    return
                }
                const message = errorMessage(error)
                patch(item.id, { status: 'failed', error: message })
                if (mediaId) void failOnServer(mediaId, message)
                else afterFinish()
                toast.error(`${file.name} failed to upload`, { description: message })
            } finally {
                controllers.current.delete(item.id)
                files.current.delete(item.id)
            }
        },
        [utils, patch, store, failOnServer, afterFinish]
    )

    // Queue pump: keep up to MAX_FILES uploading.
    const structure = useUploadSelector(store, selectStructure)
    useEffect(() => {
        const items = store.get()
        let active = items.filter((item) => item.status === 'uploading').length
        for (const item of items) {
            if (active >= MAX_FILES) break
            if (item.status !== 'queued' || started.current.has(item.id)) continue
            started.current.add(item.id)
            active += 1
            patch(item.id, { status: 'uploading' })
            void upload(item)
        }
    }, [structure, store, patch, upload])

    // Processing → ready/failed: poll the media until Inngest is done.
    const processingIds = useUploadSelector(store, (items) =>
        items
            .filter((item) => item.status === 'processing' && item.mediaId)
            .map((item) => `${item.id}:${item.mediaId}`)
            .join(',')
    )
    useEffect(() => {
        if (!processingIds) return
        const timer = setInterval(() => {
            for (const pair of processingIds.split(',')) {
                const [id, mediaId] = pair.split(':') as [string, string]
                if (Date.now() - (processingSince.current.get(id) ?? 0) > POLL_GIVE_UP_MS) continue
                utils.client.media.get
                    .query({ mediaId })
                    .then(async (media) => {
                        if (media.status !== 'ready' && media.status !== 'failed') return
                        processingSince.current.delete(id)
                        const name = media.name
                        if (media.status === 'ready') {
                            patch(id, { status: 'ready' })
                            toast.success(`${name} is ready`)
                            try {
                                await options.current.get(id)?.onReady?.(mediaId)
                            } catch (error) {
                                toast.error(errorMessage(error))
                            }
                        } else {
                            patch(id, { status: 'failed', error: media.error ?? 'Processing failed' })
                            toast.error(`${name} could not be processed`)
                        }
                        options.current.delete(id)
                        void utils.media.get.invalidate({ mediaId })
                        afterFinish()
                    })
                    .catch(() => undefined)
            }
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [processingIds, utils, patch, afterFinish])

    // Warn before leaving only while bytes are still being sent.
    const uploading = useUploadSelector(store, (items) => items.some((item) => IN_FLIGHT.includes(item.status)))
    useEffect(() => {
        if (!uploading) return
        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [uploading])

    const enqueue = useCallback(
        (list: (File | UploadEntry)[], opts?: EnqueueOptions) => {
        const accepted: UploadItem[] = []
        for (const raw of list) {
            const { file, name } = raw instanceof File ? { file: raw, name: undefined } : raw
            const detected = mediaKind(file)
            if (!detected) {
                toast.error(`${file.name} is not a video, image, subtitle (SRT/VTT) or JSON file`)
                continue
            }
            if (file.size === 0 || file.size > detected.maxBytes) {
                toast.error(`${file.name} must be between 1 byte and ${formatBytes(detected.maxBytes)}`)
                continue
            }
            const id = crypto.randomUUID()
            files.current.set(id, { file, name: name?.trim() || undefined, mimeType: detected.mimeType })
            if (opts) options.current.set(id, opts)
            accepted.push({
                id,
                name: name?.trim() || file.name,
                size: file.size,
                kind: detected.kind,
                status: 'queued',
                progress: 0,
            })
        }
        if (accepted.length) store.update((current) => [...current, ...accepted])
        },
        [store]
    )

    const cancel = useCallback(
        (id: string) => {
            const controller = controllers.current.get(id)
            if (controller) controller.abort()
            files.current.delete(id)
            options.current.delete(id)
            patch(id, { status: 'cancelled' })
        },
        [patch]
    )

    const dismiss = useCallback(
        (id: string) => store.update((current) => current.filter((item) => item.id !== id)),
        [store]
    )

    const clearFinished = useCallback(
        () => store.update((current) => current.filter((item) => ACTIVE.includes(item.status))),
        [store]
    )

    const value = useMemo<UploadContextValue>(
        () => ({ store, enqueue, cancel, dismiss, clearFinished }),
        [store, enqueue, cancel, dismiss, clearFinished]
    )

    return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
}

function useUploadContext(): UploadContextValue {
    const value = useContext(UploadContext)
    if (!value) throw new Error('Upload hooks must be used inside <UploadProvider>')
    return value
}

/** Stable actions; never re-renders on progress. */
export function useUploadActions() {
    const { enqueue, cancel, dismiss, clearFinished } = useUploadContext()
    return useMemo(() => ({ enqueue, cancel, dismiss, clearFinished }), [enqueue, cancel, dismiss, clearFinished])
}

/** Full list with progress. Only the list/rows should use this. */
export function useUploadItems(): UploadItem[] {
    return useUploadSelector(useUploadContext().store, selectItems)
}

/** Total items; unaffected by progress ticks. */
export function useUploadCount(): number {
    return useUploadSelector(useUploadContext().store, selectCount)
}

/** Items still queued, uploading or processing; unaffected by progress ticks. */
export function useUploadActiveCount(): number {
    return useUploadSelector(useUploadContext().store, selectActiveCount)
}
