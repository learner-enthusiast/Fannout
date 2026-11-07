import {
    BracesIcon,
    CaptionsIcon,
    FileIcon,
    FilmIcon,
    ImageIcon,
    RectangleHorizontalIcon,
    RectangleVerticalIcon,
    SquareIcon,
} from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import { ORIENTATION_LABEL, TYPE_LABEL, type MediaType, type Orientation } from '~/lib/media-roles'

const TYPE_ICON = {
    video: FilmIcon,
    image: ImageIcon,
    subtitle: CaptionsIcon,
    json: BracesIcon,
    other: FileIcon,
} as const

const ORIENTATION_ICON = {
    landscape: RectangleHorizontalIcon,
    portrait: RectangleVerticalIcon,
    square: SquareIcon,
} as const

export function TypeBadge({ type }: { type: MediaType }) {
    const Icon = TYPE_ICON[type]
    return (
        <Badge variant="outline">
            <Icon aria-hidden />
            {TYPE_LABEL[type]}
        </Badge>
    )
}

export function OrientationBadge({ orientation }: { orientation: Orientation | null }) {
    if (!orientation) return null
    const Icon = ORIENTATION_ICON[orientation]
    return (
        <Badge variant="neutral">
            <Icon aria-hidden />
            {ORIENTATION_LABEL[orientation]}
        </Badge>
    )
}
