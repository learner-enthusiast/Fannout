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

import type { MediaLite } from '~/lib/compose'
import { fingerprintOf, orientationOf, readLocalMeta, revokePreview, serial } from '~/lib/local-media'
import { formatBytes, mediaKind, nameFromFilename, type UploadKind } from '~/lib/media-format'
import { normalizeTRPCError } from '~/lib/error'
import { trpc } from '~/trpc/client'

import { forgetUpload, loadPersistedUploads, persistUpload, type PersistedUpload } from './upload-persist'
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
 * Background uploads: the one upload engine. Mounted once in the (app)
 * layout so uploads keep going across route changes. Files go straight to S3
 * as multipart uploads (presigned part URLs); the API is only told to start,
 * re-sign, complete or fail.
 *
 * - the media row exists from init (status "uploading"), so a post can use it at once
 * - identical files (fingerprint) that are already ready are reused: no upload
 * - at most 3 files at a time (smallest first), 4 parts per file in parallel
 * - each part: 5 tries with exponential backoff + jitter; expired URLs are re-signed
 * - offline → paused, online → resumed from the completed parts
 * - progress lives in a throttled external store (≤ 5 updates/s)
 * - completed parts are kept in IndexedDB: after a reload, re-selecting the
 *   same file continues where it stopped
 */

export type UploadStatus =
    /** Reading the file locally (preview, metadata, fingerprint) and creating the media row. */
    | 'preparing'
    | 'queued'
    | 'uploading'
    | 'paused'
    /** Restored after a reload: the browser needs the file again (re-select it). */
    | 'needs_file'
    | 'processing'
    | 'ready'
    | 'failed'
    | 'cancelled'

export type UploadSlot = 'video' | 'photos' | 'thumbnail' | 'subtitles' | 'json'

const SLOT_KIND: Record<UploadSlot, UploadKind> = {
    video: 'video',
    photos: 'image',
    thumbnail: 'image',
    subtitles: 'subtitle',
    json: 'json',
}
const SLOT_NOUN: Record<UploadSlot, string> = {
    video: 'a video',
    photos: 'images',
    thumbnail: 'images',
    subtitles: 'SRT/VTT subtitles',
    json: 'a JSON file',
}

export type UploadItem = {
    id: string
    name: string
    size: number
    kind: UploadKind
    mimeType: string
    status: UploadStatus
    /** 0..1 of bytes sent to storage. */
    progress: number
    /** Bytes per second (smoothed) while uploading. */
    speed?: number
    etaSeconds?: number | null
    mediaId?: string
    error?: string
    pausedBy?: 'user' | 'offline'
    /** Object URL (image or video poster) for instant previews. */
    previewUrl?: string | null
    width?: number | null
    height?: number | null
    durationSeconds?: number | null
    fingerprint?: string | null
    /** An identical ready file was found: nothing was uploaded. */
    reused?: boolean
    /** Posts created with this file before it finished (posts list shows "Uploading 45%"). */
    postIds: string[]
}

export type AddedMedia = { uploadId: string; mediaId: string; lite: MediaLite }

export type AddOptions = {
    /** Compose slot: the file type must match (the server checks it too). */
    slot?: UploadSlot
    /** Runs once the media is processed and ready (e.g. auto-link a thumbnail). */
    onReady?: (mediaId: string) => void | Promise<void>
}

export type UploadEntry = { file: File; name?: string }

/** Runtime state that isn't rendered (and can't be: File, AbortController). */
type Job = {
    file: File | null
    slot?: UploadSlot
    partSize: number
    partCount: number
    urls: Map<number, { url: string; at: number }>
    done: Map<number, string>
    controller?: AbortController
    abortReason?: 'pause' | 'offline' | 'cancel'
    signing?: Promise<void> | null
    onReady?: AddOptions['onReady']
    createdAt: number
    filename: string
}

/**
 * The context value is STABLE (store + memoized actions). Progress is never in
 * context: read it through the selector hooks below.
 */
type UploadContextValue = {
    store: UploadStore
    /** Reads, validates and registers files; resolves once each has a media id (upload continues in the background). */
    addFiles: (files: (File | UploadEntry)[], options?: AddOptions) => Promise<AddedMedia[]>
    /** Library page: fire and forget. */
    enqueue: (files: (File | UploadEntry)[], options?: AddOptions) => void
    pause: (id: string) => void
    resume: (id: string) => void
    retry: (id: string) => void
    cancel: (id: string) => void
    /** After a reload: hand the same file back to continue. */
    reattach: (id: string, file: File) => Promise<boolean>
    dismiss: (id: string) => void
    clearFinished: () => void
    /** Remember which posts wait on these files (posts list progress). */
    linkPosts: (mediaIds: string[], postIds: string[]) => void
}

const UploadContext = createContext<UploadContextValue | null>(null)

const MAX_FILES = 3
const PARTS_IN_PARALLEL = 4
const PART_TRIES = 5
const SIGN_BATCH = 20
/** Presigned part URLs live 12 h; refresh well before. */
const URL_MAX_AGE_MS = 11 * 60 * 60 * 1000
const POLL_MS = 3000
const POLL_GIVE_UP_MS = 30 * 60 * 1000

class FatalUploadError extends Error {}
class ExpiredUrlError extends Error {}
class OfflineError extends Error {}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
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
function putPart(url: string, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', url)
        xhr.upload.onprogress = (event) => onProgress(event.loaded)
        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                const message = `Storage responded ${xhr.status}`
                // 403 = the presigned URL expired: re-sign and try again.
                if (xhr.status === 403) return reject(new ExpiredUrlError(message))
                // Other 4xx (except timeout / rate limit) won't fix themselves.
                if (xhr.status >= 400 && xhr.status < 500 && ![408, 429].includes(xhr.status)) return reject(new FatalUploadError(message))
                return reject(new Error(message))
            }
            const etag = xhr.getResponseHeader('ETag')
            if (!etag) return reject(new FatalUploadError('Storage did not return an ETag (bucket CORS must expose the ETag header)'))
            onProgress(body.size)
            resolve(etag)
        }
        xhr.onerror = () => reject(isOffline() ? new OfflineError('Connection lost') : new Error('Network error'))
        xhr.ontimeout = () => reject(new Error('Timed out'))
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
        xhr.send(body)
    })
}

/** Exponential backoff + jitter. `attempt` gets the try number and the previous error. */
async function withRetry<T>(signal: AbortSignal, attempt: (tries: number, previous: unknown) => Promise<T>): Promise<T> {
    let previous: unknown = null
    for (let tries = 0; ; tries += 1) {
        try {
            return await attempt(tries, previous)
        } catch (error) {
            if (signal.aborted || error instanceof FatalUploadError) throw error
            if (error instanceof OfflineError || isOffline()) throw new OfflineError('Connection lost')
            if (tries + 1 >= PART_TRIES) throw error
            previous = error
            await sleep(Math.min(15_000, 500 * 2 ** tries) + Math.random() * 500, signal)
        }
    }
}

/** Runs `worker` over items with at most `limit` in flight; stops on first error. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    let next = 0
    let failed = false
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (!failed && next < items.length) {
            const item = items[next++]!
            try {
                await worker(item)
            } catch (error) {
                failed = true
                throw error
            }
        }
    })
    await Promise.all(lanes)
}

function errorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message.slice(0, 300)
    return 'Upload failed'
}

function liteOf(item: UploadItem, mediaId: string): MediaLite {
    const type = item.kind
    return {
        id: mediaId,
        name: nameFromFilename(item.name),
        type,
        status: item.reused ? 'ready' : 'uploading',
        url: type === 'image' ? (item.previewUrl ?? null) : null,
        thumbUrl: item.previewUrl ?? null,
        orientation: orientationOf(item.width ?? null, item.height ?? null),
        durationSeconds: item.durationSeconds ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
    }
}

export function UploadProvider({ children }: { children: ReactNode }) {
    const utils = trpc.useUtils()
    const [store] = useState(createUploadStore)
    const jobs = useRef(new Map<string, Job>())
    const processingSince = useRef(new Map<string, number>())
    // Hashing and poster capture: one file at a time.
    const [prepare] = useState(serial)

    const patch = useCallback(
        (id: string, update: Partial<UploadItem>) =>
            store.update((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item))),
        [store]
    )
    const itemOf = useCallback((id: string) => store.get().find((item) => item.id === id), [store])

    const afterFinish = useCallback(() => {
        void utils.media.list.invalidate()
        void utils.notifications.unreadCount.invalidate()
        void utils.notifications.list.invalidate()
    }, [utils])

    const persist = useCallback(
        (id: string) => {
            const item = itemOf(id)
            const job = jobs.current.get(id)
            if (!item?.mediaId || !job) return
            const record: PersistedUpload = {
                id,
                mediaId: item.mediaId,
                name: item.name,
                filename: job.filename,
                size: item.size,
                kind: item.kind,
                mimeType: item.mimeType,
                fingerprint: item.fingerprint ?? null,
                partSize: job.partSize,
                partCount: job.partCount,
                done: [...job.done],
                postIds: item.postIds,
                createdAt: job.createdAt,
            }
            void persistUpload(record)
        },
        [itemOf]
    )

    /** A fresh (or still valid) presigned URL for one part; signs a batch of the next parts at once. */
    const urlFor = useCallback(
        async (mediaId: string, job: Job, partNumber: number, force: boolean): Promise<string> => {
            for (;;) {
                const cached = job.urls.get(partNumber)
                if (cached && !force && Date.now() - cached.at < URL_MAX_AGE_MS) return cached.url
                if (job.signing) {
                    await job.signing
                    if (!force) continue
                }
                const wanted: number[] = [partNumber]
                for (let n = partNumber + 1; n <= job.partCount && wanted.length < SIGN_BATCH; n++) {
                    const known = job.urls.get(n)
                    if (!job.done.has(n) && (!known || Date.now() - known.at >= URL_MAX_AGE_MS)) wanted.push(n)
                }
                job.signing = utils.client.media.signUploadParts
                    .mutate({ mediaId, partNumbers: wanted })
                    .then((signed) => {
                        const at = Date.now()
                        for (const part of signed.parts) job.urls.set(part.partNumber, { url: part.url, at })
                    })
                    .finally(() => {
                        job.signing = null
                    })
                await job.signing
                force = false
            }
        },
        [utils]
    )

    const transfer = useCallback(
        async (id: string, mediaId: string, job: Job, signal: AbortSignal) => {
            const file = job.file!
            const sizeOf = (n: number) => Math.min(job.partSize, file.size - (n - 1) * job.partSize)
            const remaining = Array.from({ length: job.partCount }, (_, i) => i + 1).filter((n) => !job.done.has(n))
            const loaded = new Map<number, number>()
            let base = [...job.done.keys()].reduce((sum, n) => sum + sizeOf(n), 0)
            let speed = 0
            let lastBytes = base
            let lastAt = performance.now()

            const report = () => {
                const sent = base + [...loaded.values()].reduce((a, b) => a + b, 0)
                const now = performance.now()
                if (now - lastAt >= 500) {
                    const instant = ((sent - lastBytes) / (now - lastAt)) * 1000
                    speed = speed ? speed * 0.7 + instant * 0.3 : instant
                    lastBytes = sent
                    lastAt = now
                }
                store.setLive(id, {
                    progress: Math.min(0.99, sent / file.size),
                    speed,
                    etaSeconds: speed > 0 ? Math.round((file.size - sent) / speed) : null,
                })
            }
            report()

            await runPool(remaining, PARTS_IN_PARALLEL, async (n) => {
                const start = (n - 1) * job.partSize
                const blob = file.slice(start, start + job.partSize)
                const etag = await withRetry(signal, async (_tries, previous) => {
                    const url = await urlFor(mediaId, job, n, previous instanceof ExpiredUrlError)
                    return putPart(url, blob, signal, (bytes) => {
                        loaded.set(n, bytes)
                        report()
                    })
                })
                job.done.set(n, etag)
                loaded.delete(n)
                base += blob.size
                persist(id)
                report()
            })
        },
        [store, urlFor, persist]
    )

    const start = useCallback(
        async (id: string) => {
            const job = jobs.current.get(id)
            const item = itemOf(id)
            if (!job || !item?.mediaId) return
            if (!job.file) return patch(id, { status: 'needs_file' })
            const controller = new AbortController()
            job.controller = controller
            job.abortReason = undefined
            const mediaId = item.mediaId
            try {
                await transfer(id, mediaId, job, controller.signal)
                const parts = [...job.done].map(([partNumber, etag]) => ({ partNumber, etag }))
                await utils.client.media.completeUpload.mutate({ mediaId, parts })
                void forgetUpload(id)
                job.file = null
                processingSince.current.set(id, Date.now())
                patch(id, { status: 'processing', progress: 1, speed: undefined, etaSeconds: null })
                void utils.media.list.invalidate()
            } catch (error) {
                const reason = job.abortReason
                if (reason === 'cancel') return
                if (reason === 'pause') return patch(id, { status: 'paused', pausedBy: 'user', speed: undefined, etaSeconds: null })
                if (reason === 'offline' || error instanceof OfflineError) {
                    return patch(id, { status: 'paused', pausedBy: 'offline', speed: undefined, etaSeconds: null })
                }
                const { code } = normalizeTRPCError(error)
                const message = code === 'CONFLICT' ? 'This upload expired. Pick the file again.' : errorMessage(error)
                patch(id, { status: 'failed', error: message, speed: undefined, etaSeconds: null })
                if (code === 'CONFLICT') {
                    void forgetUpload(id)
                    jobs.current.delete(id)
                }
                toast.error(`${item.name} didn't upload`, { description: `${message} You can retry it from the uploads list.` })
            } finally {
                job.controller = undefined
            }
        },
        [itemOf, patch, transfer, utils]
    )

    // Queue pump: up to MAX_FILES uploading, smallest first (thumbnails before a 2 GB video).
    const structure = useUploadSelector(store, selectStructure)
    useEffect(() => {
        const items = store.get()
        let active = items.filter((item) => item.status === 'uploading').length
        const queued = items.filter((item) => item.status === 'queued').sort((a, b) => a.size - b.size)
        for (const item of queued) {
            if (active >= MAX_FILES) break
            active += 1
            patch(item.id, { status: 'uploading' })
            void start(item.id)
        }
    }, [structure, store, patch, start])

    // Network drops pause everything in flight; coming back resumes from the completed parts.
    useEffect(() => {
        const offline = () => {
            for (const item of store.get()) {
                const job = jobs.current.get(item.id)
                if (item.status === 'uploading' && job?.controller) {
                    job.abortReason = 'offline'
                    job.controller.abort()
                } else if (item.status === 'queued') patch(item.id, { status: 'paused', pausedBy: 'offline' })
            }
        }
        const online = () => {
            for (const item of store.get()) {
                if (item.status === 'paused' && item.pausedBy === 'offline') patch(item.id, { status: 'queued', pausedBy: undefined })
            }
        }
        window.addEventListener('offline', offline)
        window.addEventListener('online', online)
        return () => {
            window.removeEventListener('offline', offline)
            window.removeEventListener('online', online)
        }
    }, [store, patch])

    // Restore uploads interrupted by a reload: they wait for the user to re-select the file.
    useEffect(() => {
        let cancelled = false
        void (async () => {
            const records = await loadPersistedUploads()
            for (const record of records) {
                if (cancelled || jobs.current.has(record.id)) continue
                const media = await utils.client.media.get.query({ mediaId: record.mediaId }).catch(() => null)
                if (cancelled) return
                if (!media || media.status !== 'uploading') {
                    void forgetUpload(record.id)
                    continue
                }
                jobs.current.set(record.id, {
                    file: null,
                    partSize: record.partSize,
                    partCount: record.partCount,
                    urls: new Map(),
                    done: new Map(record.done),
                    createdAt: record.createdAt,
                    filename: record.filename,
                })
                const sent = record.done.reduce((sum, [n]) => sum + Math.min(record.partSize, record.size - (n - 1) * record.partSize), 0)
                store.update((current) => [
                    ...current,
                    {
                        id: record.id,
                        name: record.name,
                        size: record.size,
                        kind: record.kind,
                        mimeType: record.mimeType,
                        status: 'needs_file',
                        progress: record.size ? sent / record.size : 0,
                        mediaId: record.mediaId,
                        fingerprint: record.fingerprint,
                        postIds: record.postIds,
                        error: `Upload paused: re-select ${record.filename} to continue`,
                    },
                ])
            }
        })()
        return () => {
            cancelled = true
        }
    }, [store, utils])

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
                        const job = jobs.current.get(id)
                        if (media.status === 'ready') {
                            patch(id, { status: 'ready' })
                            try {
                                await job?.onReady?.(mediaId)
                            } catch (error) {
                                toast.error(errorMessage(error))
                            }
                        } else {
                            patch(id, { status: 'failed', error: media.error ?? 'Processing failed' })
                            toast.error(`${media.name} could not be processed`, { description: media.error ?? undefined })
                        }
                        jobs.current.delete(id)
                        void utils.media.get.invalidate({ mediaId })
                        afterFinish()
                    })
                    .catch(() => undefined)
            }
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [processingIds, utils, patch, afterFinish])

    // Warn before leaving only while bytes still have to move.
    const transferring = useUploadSelector(store, (items) =>
        items.some((item) => ['preparing', 'queued', 'uploading'].includes(item.status) || (item.status === 'paused' && item.pausedBy === 'offline'))
    )
    useEffect(() => {
        if (!transferring) return
        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [transferring])

    // Object URLs die with the provider.
    useEffect(() => () => store.get().forEach((item) => revokePreview(item.previewUrl)), [store])

    const addFiles = useCallback(
        async (list: (File | UploadEntry)[], opts: AddOptions = {}): Promise<AddedMedia[]> => {
            const added: AddedMedia[] = []
            for (const raw of list) {
                const { file, name } = raw instanceof File ? { file: raw, name: undefined } : raw
                const detected = mediaKind(file)
                if (!detected) {
                    toast.error(`${file.name} is not a video, image, subtitle (SRT/VTT) or JSON file`)
                    continue
                }
                if (opts.slot && SLOT_KIND[opts.slot] !== detected.kind) {
                    toast.error(`${file.name} wasn't added: this slot takes ${SLOT_NOUN[opts.slot]}`)
                    continue
                }
                if (file.size === 0 || file.size > detected.maxBytes) {
                    toast.error(`${file.name} must be between 1 byte and ${formatBytes(detected.maxBytes)}`)
                    continue
                }
                const id = crypto.randomUUID()
                const display = name?.trim() || file.name
                store.update((current) => [
                    ...current,
                    { id, name: display, size: file.size, kind: detected.kind, mimeType: detected.mimeType, status: 'preparing', progress: 0, postIds: [] },
                ])
                try {
                    const [meta, fingerprint] = await prepare(async () => [
                        await readLocalMeta(file, detected.kind, detected.mimeType),
                        await fingerprintOf(file),
                    ] as const)
                    patch(id, {
                        previewUrl: meta.previewUrl,
                        width: meta.width,
                        height: meta.height,
                        durationSeconds: meta.durationSeconds,
                        fingerprint,
                    })

                    // Same file as an upload interrupted by a reload: continue it.
                    const waiting = fingerprint
                        ? store.get().find((item) => item.status === 'needs_file' && item.fingerprint === fingerprint && item.mediaId)
                        : undefined
                    const waitingJob = waiting ? jobs.current.get(waiting.id) : undefined
                    if (waiting && waitingJob) {
                        store.update((current) => current.filter((item) => item.id !== id))
                        waitingJob.file = file
                        if (opts.onReady) waitingJob.onReady = opts.onReady
                        patch(waiting.id, {
                            status: 'queued',
                            error: undefined,
                            previewUrl: meta.previewUrl,
                            width: meta.width,
                            height: meta.height,
                            durationSeconds: meta.durationSeconds,
                        })
                        added.push({ uploadId: waiting.id, mediaId: waiting.mediaId!, lite: liteOf(itemOf(waiting.id)!, waiting.mediaId!) })
                        continue
                    }

                    const created = await utils.client.media.createUpload.mutate({
                        filename: file.name,
                        mimeType: detected.mimeType,
                        sizeBytes: file.size,
                        ...(name?.trim() ? { name: name.trim() } : {}),
                        ...(opts.slot ? { slot: opts.slot } : {}),
                        ...(fingerprint ? { fingerprint } : {}),
                        presignLimit: SIGN_BATCH,
                    })
                    if (created.reused) {
                        patch(id, { status: 'ready', progress: 1, mediaId: created.mediaId, reused: true })
                        void opts.onReady?.(created.mediaId)
                    } else {
                        const at = Date.now()
                        jobs.current.set(id, {
                            file,
                            slot: opts.slot,
                            partSize: created.partSize,
                            partCount: created.partCount,
                            urls: new Map(created.parts.map((part) => [part.partNumber, { url: part.url, at }])),
                            done: new Map(),
                            onReady: opts.onReady,
                            createdAt: at,
                            filename: file.name,
                        })
                        patch(id, { status: isOffline() ? 'paused' : 'queued', pausedBy: isOffline() ? 'offline' : undefined, mediaId: created.mediaId })
                        persist(id)
                    }
                    added.push({ uploadId: id, mediaId: created.mediaId, lite: liteOf(itemOf(id)!, created.mediaId) })
                } catch (error) {
                    const message = normalizeTRPCError(error).message || errorMessage(error)
                    patch(id, { status: 'failed', error: message })
                    toast.error(`${file.name} wasn't added`, { description: message })
                }
            }
            if (added.length) void utils.media.list.invalidate()
            return added
        },
        [store, patch, prepare, itemOf, utils, persist]
    )

    const enqueue = useCallback((list: (File | UploadEntry)[], opts?: AddOptions) => void addFiles(list, opts), [addFiles])

    const pause = useCallback(
        (id: string) => {
            const item = itemOf(id)
            const job = jobs.current.get(id)
            if (item?.status === 'uploading' && job?.controller) {
                job.abortReason = 'pause'
                job.controller.abort()
                patch(id, { status: 'paused', pausedBy: 'user' })
            } else if (item?.status === 'queued') patch(id, { status: 'paused', pausedBy: 'user' })
        },
        [itemOf, patch]
    )

    const resume = useCallback(
        (id: string) => {
            const job = jobs.current.get(id)
            if (!job) return
            patch(id, job.file ? { status: 'queued', pausedBy: undefined, error: undefined } : { status: 'needs_file' })
        },
        [patch]
    )

    const retry = useCallback(
        (id: string) => {
            const job = jobs.current.get(id)
            if (job?.file) return patch(id, { status: 'queued', error: undefined })
            toast.error('Pick the file again to retry')
        },
        [patch]
    )

    const cancel = useCallback(
        (id: string) => {
            const item = itemOf(id)
            const job = jobs.current.get(id)
            if (job) {
                job.abortReason = 'cancel'
                job.controller?.abort()
                job.file = null
            }
            jobs.current.delete(id)
            void forgetUpload(id)
            // Optimistic: gone from slots right away; the server aborts the multipart upload.
            patch(id, { status: 'cancelled', speed: undefined, etaSeconds: null })
            if (item?.mediaId && !item.reused && !['ready', 'processing', 'failed', 'cancelled'].includes(item.status)) {
                void utils.client.media.failUpload
                    .mutate({ mediaId: item.mediaId, error: 'Cancelled' })
                    .then(afterFinish)
                    .catch(() => undefined)
            }
        },
        [itemOf, patch, utils, afterFinish]
    )

    const reattach = useCallback(
        async (id: string, file: File) => {
            const item = itemOf(id)
            const job = jobs.current.get(id)
            if (!item || !job) return false
            const fingerprint = await prepare(() => fingerprintOf(file))
            if (file.size !== item.size || (item.fingerprint && fingerprint !== item.fingerprint)) {
                toast.error(`That isn't the same file as ${item.name}`)
                return false
            }
            job.file = file
            patch(id, { status: 'queued', error: undefined })
            return true
        },
        [itemOf, prepare, patch]
    )

    const remove = useCallback(
        (keep: (item: UploadItem) => boolean) =>
            store.update((current) =>
                current.filter((item) => {
                    if (keep(item)) return true
                    revokePreview(item.previewUrl)
                    jobs.current.delete(item.id)
                    return false
                })
            ),
        [store]
    )

    const dismiss = useCallback((id: string) => remove((item) => item.id !== id), [remove])
    const clearFinished = useCallback(() => remove((item) => ACTIVE_STATUSES.includes(item.status)), [remove])

    const linkPosts = useCallback(
        (mediaIds: string[], postIds: string[]) => {
            const linked = store.get().filter((item) => item.mediaId && mediaIds.includes(item.mediaId))
            if (!linked.length || !postIds.length) return
            store.update((current) =>
                current.map((item) =>
                    item.mediaId && mediaIds.includes(item.mediaId) ? { ...item, postIds: [...new Set([...item.postIds, ...postIds])] } : item
                )
            )
            for (const item of linked) persist(item.id)
        },
        [store, persist]
    )

    const value = useMemo<UploadContextValue>(
        () => ({ store, addFiles, enqueue, pause, resume, retry, cancel, reattach, dismiss, clearFinished, linkPosts }),
        [store, addFiles, enqueue, pause, resume, retry, cancel, reattach, dismiss, clearFinished, linkPosts]
    )

    return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
}

function useUploadContext(): UploadContextValue {
    const value = useContext(UploadContext)
    if (!value) throw new Error('Upload hooks must be used inside <UploadProvider>')
    return value
}

/** Stable actions; never re-renders on progress. */
export function useUploadActions(): Omit<UploadContextValue, 'store'> {
    // The context value is memoized over stable callbacks, so this never changes on progress.
    return useUploadContext()
}

/** Full list with progress. Only the tray rows should use this. */
export function useUploadItems(): UploadItem[] {
    return useUploadSelector(useUploadContext().store, selectItems)
}

/** Total items; unaffected by progress ticks. */
export function useUploadCount(): number {
    return useUploadSelector(useUploadContext().store, selectCount)
}

/** Items not finished yet; unaffected by progress ticks. */
export function useUploadActiveCount(): number {
    return useUploadSelector(useUploadContext().store, selectActiveCount)
}

/** The latest upload of one media item (progress ring). Re-renders only when that item changes. */
export function useUploadForMedia(mediaId: string | null | undefined): UploadItem | undefined {
    const { store } = useUploadContext()
    return useUploadSelector(store, (items) => {
        if (!mediaId) return undefined
        for (let i = items.length - 1; i >= 0; i--) if (items[i]!.mediaId === mediaId) return items[i]
        return undefined
    })
}

/** "mediaId:status,…" for every upload with a media id (changes on status, never on progress). */
export function useUploadStatuses(): string {
    const { store } = useUploadContext()
    return useUploadSelector(store, (items) =>
        items
            .filter((item) => item.mediaId)
            .map((item) => `${item.mediaId}:${item.status}`)
            .join(',')
    )
}

/** Percent (0–100) of the post's (or posts') files still uploading in this browser, or null when none are. */
export function usePostUploadPercent(postIds: string | string[]): number | null {
    const { store } = useUploadContext()
    const ids = typeof postIds === 'string' ? [postIds] : postIds
    return useUploadSelector(store, (items) => {
        const linked = items.filter((item) => item.postIds.some((id) => ids.includes(id)) && ['preparing', 'queued', 'uploading', 'paused', 'needs_file'].includes(item.status))
        if (!linked.length) return null
        const total = linked.reduce((sum, item) => sum + item.size, 0)
        const sent = linked.reduce((sum, item) => sum + item.size * item.progress, 0)
        return total ? Math.floor((sent / total) * 100) : 0
    })
}
