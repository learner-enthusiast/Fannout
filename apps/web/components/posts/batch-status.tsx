'use client'

import type { RouterOutputs } from '@repo/trpc/client'
import { StatusBadge, type Status } from '~/components/ui/status-badge'
import { usePostUploadPercent } from '~/components/uploads/upload-provider'

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

/**
 * A post's step line: "Uploading 45%" while its files are still uploading in
 * this browser (posted before the upload finished), else the server's step.
 */
export function PostStepText({ postId, fallback }: { postId: string; fallback: string }) {
    const percent = usePostUploadPercent(postId)
    return <>{percent !== null ? `Uploading ${percent}%` : fallback}</>
}

/** Batch badge while publishing: "Uploading 45%" until its files are up, then "Publishing". */
export function BatchPublishingBadge({ postIds }: { postIds: string[] }) {
    const percent = usePostUploadPercent(postIds)
    return <StatusBadge status={percent !== null ? 'uploading' : 'processing'} label={percent !== null ? `Uploading ${percent}%` : 'Publishing'} />
}
