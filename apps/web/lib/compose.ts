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
> & { thumbUrl?: string | null }

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
    /** Per-account thumbnail; wins over the pool. Absent/null = auto-assigned from the pool. */
    thumbnails: Record<string, string | null>
    /** Picked thumbnails; each account gets the first one matching its shape (landscape/portrait). */
    thumbnailPool: string[]
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
    thumbnails: {},
    thumbnailPool: [],
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
        const { thumbnailAll, ...parsed } = JSON.parse(raw) as Partial<ComposeDraft> & { thumbnailAll?: string | null }
        // Drafts saved before the thumbnail pool had one shared thumbnail.
        return { ...emptyDraft(), ...parsed, thumbnailPool: parsed.thumbnailPool ?? (thumbnailAll ? [thumbnailAll] : []) }
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

/** Landscape images go to landscape platforms (YouTube), portrait ones to portrait covers (Instagram). */
export function autoThumbnail(pool: MediaLite[], aspect: 'landscape' | 'portrait' | undefined): MediaLite | null {
    if (!aspect) return pool[0] ?? null
    return pool.find((m) => m.orientation === aspect) ?? pool.find((m) => !m.orientation || m.orientation === 'square') ?? null
}
