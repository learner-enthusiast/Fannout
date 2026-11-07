'use client'

import { XIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { StatusBadge, type Status } from '~/components/ui/status-badge'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import { formatBytes } from '~/lib/media-format'

import { useUploads, type UploadItem, type UploadStatus } from './upload-provider'

const badgeFor: Record<UploadStatus, { status: Status; label?: string }> = {
    queued: { status: 'pending', label: 'Queued' },
    uploading: { status: 'uploading' },
    processing: { status: 'processing' },
    ready: { status: 'ready' },
    failed: { status: 'failed' },
    cancelled: { status: 'pending', label: 'Cancelled' },
}

function UploadRow({ item }: { item: UploadItem }) {
    const { cancel, dismiss } = useUploads()
    const badge = badgeFor[item.status]
    const percent = Math.round(item.progress * 100)
    const canCancel = item.status === 'queued' || item.status === 'uploading'
    const finished = !canCancel && item.status !== 'processing'

    return (
        <li className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-label text-foreground">{item.name}</span>
                    <span className="text-meta">
                        {formatBytes(item.size)}
                        {item.error ? ` · ${item.error}` : ''}
                    </span>
                </div>
                <StatusBadge status={badge.status} label={badge.label} />
                {canCancel || finished ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={canCancel ? `Cancel ${item.name}` : `Dismiss ${item.name}`}
                                    onClick={() => (canCancel ? cancel(item.id) : dismiss(item.id))}
                                />
                            }
                        >
                            <XIcon aria-hidden />
                        </TooltipTrigger>
                        <TooltipContent>{canCancel ? 'Cancel upload' : 'Dismiss'}</TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            {item.status === 'uploading' ? (
                <div className="flex items-center gap-2">
                    <Progress
                        value={percent}
                        aria-label={`${item.name} upload progress`}
                        className="flex-1"
                    />
                    <span className="text-mono text-muted-foreground">{percent}%</span>
                </div>
            ) : null}
        </li>
    )
}

/** Per-file progress for every upload in the session. */
export function UploadList() {
    const { items } = useUploads()
    if (items.length === 0) return null
    return (
        <ul className="flex flex-col gap-4" aria-live="polite">
            {items.map((item) => (
                <UploadRow key={item.id} item={item} />
            ))}
        </ul>
    )
}
