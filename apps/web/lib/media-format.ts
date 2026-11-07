/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number | null | undefined): string {
    if (bytes == null) return '—'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** 75.4 → "1:15". */
export function formatDuration(seconds: number | null | undefined): string {
    if (seconds == null) return '—'
    const total = Math.round(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = String(total % 60).padStart(2, '0')
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024
export const MAX_TEXT_UPLOAD_BYTES = 1024 * 1024

export type UploadKind = 'image' | 'video' | 'subtitle' | 'json'

/** File inputs accept list for every uploadable kind. */
export const UPLOAD_ACCEPT = 'video/*,image/*,.srt,.vtt,application/json,.json'

/**
 * Kind + content type for a file (mirrors the API). Browsers often report ""
 * for .srt, so the extension wins for subtitles and JSON.
 */
export function mediaKind(file: { name: string; type: string }): {
    kind: UploadKind
    mimeType: string
    maxBytes: number
} | null {
    const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
    if (ext === 'srt')
        return { kind: 'subtitle', mimeType: 'application/x-subrip', maxBytes: MAX_TEXT_UPLOAD_BYTES }
    if (ext === 'vtt') return { kind: 'subtitle', mimeType: 'text/vtt', maxBytes: MAX_TEXT_UPLOAD_BYTES }
    if (ext === 'json' || file.type === 'application/json')
        return { kind: 'json', mimeType: 'application/json', maxBytes: MAX_TEXT_UPLOAD_BYTES }
    if (file.type.startsWith('image/')) return { kind: 'image', mimeType: file.type, maxBytes: MAX_UPLOAD_BYTES }
    if (file.type.startsWith('video/')) return { kind: 'video', mimeType: file.type, maxBytes: MAX_UPLOAD_BYTES }
    return null
}

/** "My Clip.final.mp4" → "My Clip.final" (mirrors the API default). */
export function nameFromFilename(filename: string): string {
    return filename.replace(/\.[^.]*$/, '').trim().slice(0, 200) || 'Untitled'
}
