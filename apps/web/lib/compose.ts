import type { RouterOutputs } from '@repo/trpc/client'
import twitterText from 'twitter-text'

export type Capabilities = RouterOutputs['platforms']['capabilities'][number]
export type ComposeField = Capabilities['fields'][number]
export type Platform = Capabilities['platform']
export type ComposeMediaType = 'video' | 'photos'
export type MediaView = RouterOutputs['media']['list']['items'][number]
/** The subset of a media item the composer uses (library items and folder items both fit). */
export type MediaLite = Pick<
    MediaView,
    'id' | 'name' | 'type' | 'status' | 'url' | 'orientation' | 'durationSeconds' | 'width' | 'height'
> & { thumbUrl?: string | null; mimeType?: string }

const FORMAT_BY_EXT: Record<string, string> = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    webp: 'webp',
    gif: 'gif',
    heic: 'heic',
    heif: 'heic',
    avif: 'avif',
    bmp: 'bmp',
    tif: 'tiff',
    tiff: 'tiff',
}
const FORMAT_LABEL: Record<string, string> = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', gif: 'GIF', heic: 'HEIC', avif: 'AVIF', bmp: 'BMP', tiff: 'TIFF' }

/** Image format name (as in capabilities.imageFormats) from the MIME type, else the file extension. */
function imageFormatOf(media: MediaLite): string | null {
    const sub = media.mimeType?.toLowerCase().replace(/^image\//, '')
    if (sub) return FORMAT_BY_EXT[sub === 'pjpeg' ? 'jpeg' : sub === 'x-ms-bmp' ? 'bmp' : sub] ?? null
    return FORMAT_BY_EXT[media.name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

/**
 * "PNG will be converted to JPEG (same size and shape)" when a picked image isn't in a format the
 * platform takes for its slot (capabilities.imageFormats). Info only: Fannout converts at publish time.
 */
export function conversionNote(
    capabilities: Capabilities,
    mediaType: ComposeMediaType,
    photos: MediaLite[],
    thumbnail: MediaLite | null
): string | null {
    const rules = capabilities.imageFormats
    if (!rules) return null
    const items =
        mediaType === 'photos'
            ? photos.map((photo) => ({ media: photo, rule: rules[photos.length > 1 ? 'carouselImage' : 'image'] }))
            : thumbnail
              ? [{ media: thumbnail, rule: rules.cover }]
              : []
    const from = new Set<string>()
    let to: string | null = null
    for (const { media, rule } of items) {
        const format = imageFormatOf(media)
        if (!rule || !format || (rule.acceptedImageFormats as string[]).includes(format)) continue
        if (!(rule.acceptedImageFormats as string[]).includes('jpeg')) continue
        from.add(FORMAT_LABEL[format] ?? format.toUpperCase())
        to = 'JPEG'
    }
    if (!to || from.size === 0) return null
    const names = [...from]
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
    return `${list} will be converted to ${to} (same size and shape)`
}

/**
 * Per-platform media checks the server can't make yet: a file that is still
 * uploading has no probed duration, so the browser-read one is used. Size and
 * format are known from upload init and come back from posts.validate.
 * The file stays in the post for the other platforms.
 */
export function localMediaIssues(capabilities: Capabilities, mediaType: ComposeMediaType, video: MediaLite | null): string[] {
    if (mediaType !== 'video' || !video || video.status === 'ready' || video.durationSeconds == null) return []
    const rules = capabilities.mediaRules
    const issues: string[] = []
    if (rules.maxVideoSeconds && video.durationSeconds > rules.maxVideoSeconds) {
        const limit = rules.maxVideoSeconds < 600 ? `${rules.maxVideoSeconds} s` : `${Math.round(rules.maxVideoSeconds / 60)} min`
        issues.push(`${capabilities.label}: video longer than ${limit}`)
    }
    if (rules.minVideoSeconds && video.durationSeconds < rules.minVideoSeconds) {
        issues.push(`${capabilities.label}: video shorter than ${rules.minVideoSeconds} s`)
    }
    return issues
}

/** Still on its way to "ready" (uploading in this browser, or processing on the server). */
export const isInFlight = (media: Pick<MediaLite, 'status'> | null | undefined) =>
    Boolean(media && media.status !== 'ready' && media.status !== 'failed')
export type Issue = RouterOutputs['posts']['validate']['issues'][number]
/** AI playbook a card gets: video, short (Shorts/Reels), image or carousel (2+ photos). */
export type PostType = 'video' | 'short' | 'image' | 'carousel'
export type AiSource = 'json' | 'srt' | 'photos'
export const AI_SOURCE_LABEL: Record<AiSource, string> = { json: 'from JSON', srt: 'from SRT', photos: 'from photos' }

/** Everything the composer needs to rebuild itself after a reload. */
export type ComposeDraft = {
    /** Selection order = card order. */
    accountIds: string[]
    mediaType: ComposeMediaType
    videoId: string | null
    photoIds: string[]
    folderId: string | null
    inputs: Record<string, Record<string, unknown>>
    /**
     * Per-connection thumbnail override, keyed by connection id: a media id, or "none" (no thumbnail).
     * Absent = follow the master. The effective thumbnail is derived (resolveThumbnail), never copied.
     */
    thumbnailOverrides: Record<string, ThumbnailOverride>
    /** Master thumbnails (one or more). Cards without an override follow them. */
    thumbnailMaster: string[]
    /** Photos mode: per-account subset/order. */
    photoOverrides: Record<string, string[]>
    /** One key per submit attempt; a retried click re-uses it (no duplicates). */
    idempotencyKey: string
    /** AI sources (either, both or none). */
    aiJsonId: string | null
    aiSubtitleId: string | null
    /** Fields last filled by AI: the value it wrote + the value before (for Undo). */
    aiFills: Record<string, Record<string, { value: unknown; previous: unknown }>>
    /** Notes from the last generation, e.g. "Shortened automatically". */
    aiIssues: Record<string, Record<string, string>>
    /** What the last generation wrote each card from. */
    aiSources: Record<string, AiSource>
    /** Global and per-account AI instructions, kept until the draft is posted. */
    globalInstruction: string
    accountInstructions: Record<string, string>
    /** Per-card schedule (wins over scheduleAll); absent = instant unless scheduleAll is set. */
    schedules: Record<string, { at: string; timezone: string }>
    /** "Schedule all…" fallback time for cards without their own. */
    scheduleAll: { at: string; timezone: string } | null
}

export const emptyDraft = (): ComposeDraft => ({
    accountIds: [],
    mediaType: 'video',
    videoId: null,
    photoIds: [],
    folderId: null,
    inputs: {},
    thumbnailOverrides: {},
    thumbnailMaster: [],
    photoOverrides: {},
    idempotencyKey: crypto.randomUUID(),
    aiJsonId: null,
    aiSubtitleId: null,
    aiFills: {},
    aiIssues: {},
    aiSources: {},
    globalInstruction: '',
    accountInstructions: {},
    schedules: {},
    scheduleAll: null,
})

const DRAFT_KEY = 'fannout-compose-draft'

export function loadDraft(): ComposeDraft | null {
    try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (!raw) return null
        const { thumbnailAll, thumbnailPool, thumbnails, ...parsed } = JSON.parse(raw) as Partial<ComposeDraft> & {
            thumbnailAll?: string | null
            thumbnailPool?: string[]
            thumbnails?: Record<string, string | null>
        }
        // Older drafts: one shared thumbnail (thumbnailAll), then a pool + per-account picks (null = auto).
        const legacyOverrides = Object.fromEntries(Object.entries(thumbnails ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1])))
        return {
            ...emptyDraft(),
            ...parsed,
            thumbnailMaster: parsed.thumbnailMaster ?? thumbnailPool ?? (thumbnailAll ? [thumbnailAll] : []),
            thumbnailOverrides: parsed.thumbnailOverrides ?? legacyOverrides,
        }
    } catch {
        return null
    }
}

export function saveDraft(draft: ComposeDraft) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
        // Private mode / storage full: the draft just isn't kept.
    }
}

export function clearDraft() {
    try {
        localStorage.removeItem(DRAFT_KEY)
    } catch {
        // ignore
    }
}

/** social_connections.provider → composer platform. */
export const platformOf = (provider: string): Platform | null => {
    const value = provider.toLowerCase()
    return ['youtube', 'x', 'linkedin', 'threads', 'facebook', 'instagram'].includes(value) ? (value as Platform) : null
}

/** YouTube tags length as YouTube counts it (same as the server's youtubeTagsLength): commas between, +2 per tag with a space. */
export const tagsLength = (tags: string[]): number =>
    tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), 0) + Math.max(0, tags.length - 1)

/** X weighted length (official twitter-text, same as the server). */
export const xWeight = (text: string): number => twitterText.parseTweet(text).weightedLength

/** Platforms whose main format is vertical; a folder prefers main_portrait for them. */
const PORTRAIT_FIRST: Platform[] = ['threads', 'instagram']

export const prefersPortrait = (platforms: Platform[]) =>
    platforms.length > 0 && platforms.every((p) => PORTRAIT_FIRST.includes(p))

/** The card's main text field (for "Copy text from…"). */
export const textFieldOf = (capabilities: Capabilities, mediaType?: ComposeMediaType) =>
    capabilities.fields.find((f) => f.kind === 'textarea' && (!f.mediaType || f.mediaType === mediaType)) ??
    capabilities.fields.find((f) => f.kind === 'text' && (!f.mediaType || f.mediaType === mediaType))

/** A multi-photo post the platform has no API for: Fannout prepares it, the user publishes it by hand. */
export const isManualPost = (capabilities: Capabilities, mediaType: ComposeMediaType, photoCount: number) =>
    mediaType === 'photos' && capabilities.carouselMode === 'manual' && photoCount >= 2

/** How people are tagged on this card's media right now (none = no "Tag people"). */
export const tagModeOf = (capabilities: Capabilities, mediaType: ComposeMediaType) =>
    mediaType === 'video' ? capabilities.tagging.video : capabilities.tagging.image

/** Composer-side tag: photos are tracked by media id so reordering slides keeps the tags on their photo. */
export type DraftUserTag = { mediaId?: string; username: string; x?: number; y?: number }
export type TaggedUser = { username: string; xUserId: string }

/** Saves a base64 file returned by the API (e.g. the images zip of a manual post). */
export function downloadBase64(filename: string, base64: string, type: string) {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
}

export const isEmpty = (value: unknown) =>
    value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

/** Same value (deep enough for strings, booleans and string arrays). */
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Which AI playbook (and length band) applies to a card right now. */
export function postTypeOf(
    capabilities: Capabilities,
    mediaType: ComposeMediaType,
    video: Pick<MediaLite, 'orientation' | 'durationSeconds'> | null,
    photoCount: number
): PostType {
    if (mediaType === 'photos') return photoCount > 1 ? 'carousel' : 'image'
    if (capabilities.platform === 'instagram') return 'short'
    const shortMax = capabilities.mediaRules.shortMaxSeconds
    return shortMax && video?.orientation === 'portrait' && (video.durationSeconds ?? Infinity) <= shortMax ? 'short' : 'video'
}

/** The length band AI aims for on this field (undefined = no target, only the limit). */
export const bandOf = (field: ComposeField, postType: PostType) =>
    field.aiBands?.[postType] ?? (postType === 'short' ? field.aiBands?.video : postType === 'video' ? field.aiBands?.short : undefined)

// ---- Thumbnails: master + per-connection override, always derived -------------------------------

export const THUMBNAIL_NONE = 'none'
/** A media id, or "none" = this connection posts without a custom thumbnail. */
export type ThumbnailOverride = string

/** The platform's recommended width / height, from capabilities ("1280×720 (16:9)" → 16/9; else its aspect). */
export function recommendedRatio(capabilities: Capabilities): { ratio: number; label: string } | null {
    const rules = capabilities.thumbnailRules
    if (!rules) return null
    const match = /\((\d+(?:\.\d+)?):(\d+(?:\.\d+)?)\)/.exec(rules.recommended)
    if (match) return { ratio: Number(match[1]) / Number(match[2]), label: `${match[1]}:${match[2]}` }
    return rules.aspect === 'landscape' ? { ratio: 16 / 9, label: '16:9' } : { ratio: 9 / 16, label: '9:16' }
}

/** width / height when known; square counts as 1. */
function ratioOf(media: MediaLite | undefined): number | null {
    if (media?.width && media.height) return media.width / media.height
    return media?.orientation === 'square' ? 1 : null
}

export type ResolvedThumbnail = {
    /** Effective media id, or null = platform default. */
    id: string | null
    /** custom = the card's own override ("none" included); master = follows the master; none = nothing to follow. */
    source: 'custom' | 'master' | 'none'
}

/**
 * Effective thumbnail for one connection, derived on every render:
 * 1. its override ("none" = no thumbnail); 2. the only master; 3. the master closest to the platform's
 * recommended shape (ties → first picked); 4. none. Never filtered out by shape: thumbnails are sent as-is.
 */
export function resolveThumbnail(
    capabilities: Capabilities | undefined,
    master: string[],
    override: ThumbnailOverride | undefined,
    media: Record<string, MediaLite | undefined>
): ResolvedThumbnail {
    if (!capabilities?.supportsThumbnail) return { id: null, source: 'none' }
    if (override) return { id: override === THUMBNAIL_NONE ? null : override, source: 'custom' }
    if (master.length === 0) return { id: null, source: 'none' }
    if (master.length === 1) return { id: master[0]!, source: 'master' }
    const target = recommendedRatio(capabilities)
    if (!target) return { id: master[0]!, source: 'master' }
    let best = master[0]!
    let bestDistance = Infinity
    for (const id of master) {
        const ratio = ratioOf(media[id])
        const distance = ratio ? Math.abs(Math.log(ratio / target.ratio)) : Infinity
        if (distance < bestDistance) {
            best = id
            bestDistance = distance
        }
    }
    return { id: best, source: 'master' }
}

/** Info only (never an error, never cropped): "YouTube shows 16:9 best; your image will be shown as-is". */
export function thumbnailShapeNote(capabilities: Capabilities, thumbnail: MediaLite | null): string | null {
    const target = recommendedRatio(capabilities)
    const ratio = ratioOf(thumbnail ?? undefined)
    if (!target || !ratio) return null
    // Far = more than 1.5× off (e.g. square vs 16:9, landscape vs 9:16).
    if (Math.abs(Math.log(ratio / target.ratio)) <= Math.log(1.5)) return null
    return `${capabilities.label} shows ${target.label} best; your image will be shown as-is`
}
