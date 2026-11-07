import type { RouterOutputs } from '@repo/trpc/client'
import { StatusBadge, type Status } from '~/components/ui/status-badge'

type PostStatus = RouterOutputs['posts']['batch']['posts'][number]['status']

const MAP: Record<PostStatus, { status: Status; label?: string }> = {
    draft: { status: 'pending', label: 'Draft' },
    scheduled: { status: 'pending', label: 'Scheduled' },
    queued: { status: 'pending', label: 'Queued' },
    publishing: { status: 'processing', label: 'Publishing' },
    published: { status: 'published' },
    failed: { status: 'failed' },
    cancelled: { status: 'pending', label: 'Cancelled' },
    deleting: { status: 'processing', label: 'Deleting…' },
    deleted: { status: 'pending', label: 'Deleted' },
}

export function PostStatusBadge({ status }: { status: PostStatus }) {
    const { status: badge, label } = MAP[status]
    return <StatusBadge status={badge} label={label} />
}
