export type Orientation = 'portrait' | 'landscape' | 'square'

/**
 * Browser-side facts about a picked file, read before (and independent of)
 * the upload: preview, dimensions, duration and a quick fingerprint.
 * Everything here runs one file at a time (see `serial`) so a batch of large
 * files never blocks the main thread.
 */

export type LocalMeta = {
    mimeType: string
    sizeBytes: number
    width: number | null
    height: number | null
    durationSeconds: number | null
    /** Object URL: the image itself, or a JPEG poster of a video's first frame. Revoke with `revokePreview`. */
    previewUrl: string | null
}

const FINGERPRINT_SLICE = 1024 * 1024
const META_TIMEOUT_MS = 10_000

/** "<size>-<lastModified>-<sha256 of the first 1 MB>" (matches the API's FingerprintSchema). */
export async function fingerprintOf(file: File): Promise<string | null> {
    try {
        if (!globalThis.crypto?.subtle) return null
        const head = await file.slice(0, FINGERPRINT_SLICE).arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', head)
        const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
        return `${file.size}-${Math.max(0, Math.floor(file.lastModified))}-${hex}`
    } catch {
        return null
    }
}

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), META_TIMEOUT_MS))])
}

function imageMeta(file: File): Promise<Pick<LocalMeta, 'width' | 'height' | 'previewUrl'>> {
    const url = URL.createObjectURL(file)
    return withTimeout(
        new Promise((resolve) => {
            const img = new Image()
            img.decoding = 'async'
            img.onload = () => resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null, previewUrl: url })
            // Formats the browser can't decode (e.g. HEIC on Chrome): no preview, server probes the size.
            img.onerror = () => {
                URL.revokeObjectURL(url)
                resolve({ width: null, height: null, previewUrl: null })
            }
            img.src = url
        }),
        { width: null, height: null, previewUrl: url }
    )
}

function videoMeta(file: File): Promise<Pick<LocalMeta, 'width' | 'height' | 'durationSeconds' | 'previewUrl'>> {
    const source = URL.createObjectURL(file)
    const empty = { width: null, height: null, durationSeconds: null, previewUrl: null }
    const video = document.createElement('video')
    const cleanup = () => {
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(source)
    }
    return withTimeout(
        new Promise<typeof empty | Pick<LocalMeta, 'width' | 'height' | 'durationSeconds' | 'previewUrl'>>((resolve) => {
            let facts = { width: null as number | null, height: null as number | null, durationSeconds: null as number | null }
            video.muted = true
            video.playsInline = true
            video.preload = 'metadata'
            video.onloadedmetadata = () => {
                facts = {
                    width: video.videoWidth || null,
                    height: video.videoHeight || null,
                    durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : null,
                }
                // First frame (a little in, to skip black leaders).
                video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
            }
            video.onseeked = () => {
                try {
                    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight, 1))
                    const canvas = document.createElement('canvas')
                    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
                    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
                    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
                    canvas.toBlob(
                        (blob) => {
                            cleanup()
                            resolve({ ...facts, previewUrl: blob ? URL.createObjectURL(blob) : null })
                        },
                        'image/jpeg',
                        0.8
                    )
                } catch {
                    cleanup()
                    resolve({ ...facts, previewUrl: null })
                }
            }
            video.onerror = () => {
                cleanup()
                resolve({ ...facts, previewUrl: null })
            }
            video.src = source
        }),
        empty
    )
}

/** Preview + dimensions + duration. Never throws: unknown values are null. */
export async function readLocalMeta(file: File, kind: 'image' | 'video' | 'subtitle' | 'json', mimeType: string): Promise<LocalMeta> {
    const base = { mimeType, sizeBytes: file.size, width: null, height: null, durationSeconds: null, previewUrl: null }
    try {
        if (kind === 'image') return { ...base, ...(await imageMeta(file)) }
        if (kind === 'video') return { ...base, ...(await videoMeta(file)) }
    } catch {
        // Fall through: the server probes the file anyway.
    }
    return base
}

export function revokePreview(url: string | null | undefined) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

export function orientationOf(width: number | null, height: number | null): Orientation | null {
    if (!width || !height) return null
    if (width === height) return 'square'
    return width > height ? 'landscape' : 'portrait'
}

/** Runs tasks one after another (hashing / poster capture: one file at a time). */
export function serial() {
    let tail: Promise<unknown> = Promise.resolve()
    return <T>(task: () => Promise<T>): Promise<T> => {
        const run = tail.then(task, task)
        tail = run.catch(() => undefined)
        return run
    }
}
