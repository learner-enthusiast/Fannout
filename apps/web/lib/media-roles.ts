import type { RouterOutputs } from '@repo/trpc/client'

export type MediaType = RouterOutputs['media']['get']['type']
export type Orientation = NonNullable<RouterOutputs['media']['get']['orientation']>
export type FolderRole = RouterOutputs['folders']['items']['items'][number]['role']

/** Section order + titles on the folder page (mirrors the API's FOLDER_ROLES). */
export const ROLE_SECTIONS: { role: FolderRole; title: string; label: string }[] = [
    { role: 'main_landscape', title: 'Main 16:9', label: 'Main 16:9' },
    { role: 'main_portrait', title: 'Main 9:16', label: 'Main 9:16' },
    { role: 'trailer_landscape', title: 'Trailers 16:9', label: 'Trailer 16:9' },
    { role: 'trailer_portrait', title: 'Trailers 9:16', label: 'Trailer 9:16' },
    { role: 'thumbnail', title: 'Thumbnails', label: 'Thumbnail' },
    { role: 'subtitles', title: 'Subtitles', label: 'Subtitles' },
    { role: 'social_json', title: 'Social JSON', label: 'Social JSON' },
    { role: 'other', title: 'Other', label: 'Other' },
]

export const ROLE_LABEL = Object.fromEntries(ROLE_SECTIONS.map((s) => [s.role, s.label])) as Record<
    FolderRole,
    string
>

/** Media type a role accepts (null = any). Mirrors the server rule. */
export const ROLE_TYPE: Record<FolderRole, MediaType | null> = {
    main_landscape: 'video',
    main_portrait: 'video',
    trailer_landscape: 'video',
    trailer_portrait: 'video',
    thumbnail: 'image',
    subtitles: 'subtitle',
    social_json: 'json',
    other: null,
}

export const rolesFor = (type: MediaType) =>
    ROLE_SECTIONS.filter(({ role }) => ROLE_TYPE[role] === null || ROLE_TYPE[role] === type).map(
        ({ role }) => role
    )

export const TYPE_LABEL: Record<MediaType, string> = {
    video: 'Video',
    image: 'Image',
    subtitle: 'Subtitles',
    json: 'JSON',
    other: 'File',
}

export const ORIENTATION_LABEL: Record<Orientation, string> = {
    landscape: 'Landscape',
    portrait: 'Portrait',
    square: 'Square',
}

/** Pre-guess a role from type, orientation and filename keywords ("trailer", "thumb", "9x16"). */
export function guessRole(media: {
    type: MediaType
    orientation?: Orientation | null
    name?: string | null
    originalFilename?: string | null
}): FolderRole {
    const text = `${media.name ?? ''} ${media.originalFilename ?? ''}`.toLowerCase()
    if (media.type === 'image') return 'thumbnail'
    if (media.type === 'subtitle') return 'subtitles'
    if (media.type === 'json') return 'social_json'
    if (media.type !== 'video') return 'other'
    const portrait = media.orientation === 'portrait' || /9x16|vertical|portrait|reel|short/.test(text)
    if (/trailer|teaser|promo/.test(text)) return portrait ? 'trailer_portrait' : 'trailer_landscape'
    return portrait ? 'main_portrait' : 'main_landscape'
}
