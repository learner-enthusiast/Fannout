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
export type Issue = RouterOutputs['posts']['validate']['issues'][number]

/** Everything the composer needs to rebuild itself after a reload. */
export type ComposeDraft = {
    /** Selection order = card order. */
    accountIds: string[]
    mediaType: ComposeMediaType
    videoId: string | null
    photoIds: string[]
    folderId: string | null
    inputs: Record<string, Record<string, unknown>>
    /** Per-account thumbnail; wins over thumbnailAll. Absent/null = use thumbnailAll. */
    thumbnails: Record<string, string | null>
    /** Thumbnail for every account that supports one, unless the card picks its own. */
    thumbnailAll: string | null
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
    thumbnailAll: null,
    photoOverrides: {},
    idempotencyKey: crypto.randomUUID(),
    aiJsonId: null,
    aiSubtitleId: null,
    aiFills: {},
    aiIssues: {},
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
        const parsed = JSON.parse(raw) as Partial<ComposeDraft>
        return { ...emptyDraft(), ...parsed }
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
export const textFieldOf = (capabilities: Capabilities) =>
    capabilities.fields.find((f) => f.kind === 'textarea' && !f.mediaType) ??
    capabilities.fields.find((f) => f.kind === 'text')

export const isEmpty = (value: unknown) =>
    value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

/** Same value (deep enough for strings, booleans and string arrays). */
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
