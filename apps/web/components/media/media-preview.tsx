import { BracesIcon, CaptionsIcon, FileIcon, FilmIcon, ImageIcon, type LucideIcon } from 'lucide-react'

import type { MediaType } from '~/lib/media-roles'

const ICON: Record<MediaType, LucideIcon> = {
    video: FilmIcon,
    image: ImageIcon,
    subtitle: CaptionsIcon,
    json: BracesIcon,
    other: FileIcon,
}

/**
 * 16:9 preview tile content: the image, a video's first frame, or a type
 * icon (subtitles, JSON, or anything not uploaded yet).
 */
export function MediaPreview({
    type,
    url,
    alt,
}: {
    type: MediaType
    url: string | null
    alt: string
}) {
    const Icon = ICON[type]
    return (
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-muted">
            {url && type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URLs, not optimisable
                <img src={url} alt={alt} loading="lazy" className="size-full object-cover" />
            ) : url && type === 'video' ? (
                <video
                    src={`${url}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    aria-label={alt}
                    className="size-full object-cover"
                />
            ) : (
                <Icon aria-hidden className="size-6 text-muted-foreground" />
            )}
        </div>
    )
}
