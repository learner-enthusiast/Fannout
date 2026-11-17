'use client'

import { PauseIcon, PlayIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { StatusBadge, type Status } from '~/components/ui/status-badge'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import { formatBytes, formatDuration } from '~/lib/media-format'

import { useUploadActions, useUploadItems, type UploadItem, type UploadStatus } from './upload-provider'

const badgeFor: Record<UploadStatus, { status: Status; label?: string }> = {
    preparing: { status: 'pending', label: 'Reading…' },
    queued: { status: 'pending', label: 'Queued' },
    uploading: { status: 'uploading' },
    paused: { status: 'pending', label: 'Paused' },
    needs_file: { status: 'pending', label: 'Needs file' },
    processing: { status: 'processing' },
    ready: { status: 'ready' },
    failed: { status: 'failed' },
    cancelled: { status: 'pending', label: 'Cancelled' },
}

const CANCELLABLE: UploadStatus[] = ['preparing', 'queued', 'uploading', 'paused', 'needs_file']

function detail(item: UploadItem): string {
    if (item.status === 'paused' && item.pausedBy === 'offline') return 'Connection lost, will resume automatically'
    if (item.status === 'uploading' && item.speed) {
        const eta = item.etaSeconds != null ? ` · ${formatDuration(item.etaSeconds)} left` : ''
        return `${formatBytes(item.speed)}/s${eta}`
    }
    if (item.reused) return 'Already in your library'
    return item.error ?? ''
}

function UploadRow({ item }: { item: UploadItem }) {
    const { cancel, dismiss, pause, resume, retry, reattach } = useUploadActions()
    const fileRef = useRef<HTMLInputElement>(null)
    const badge = badgeFor[item.status]
    const percent = Math.round(item.progress * 100)
    const canCancel = CANCELLABLE.includes(item.status)
    const finished = !canCancel && item.status !== 'processing'
    const info = detail(item)

    return (
        <li className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-label text-foreground">{item.name}</span>
                    <span className="text-meta">
                        {formatBytes(item.size)}
                        {info ? ` · ${info}` : ''}
                    </span>
                </div>
                <StatusBadge status={badge.status} label={badge.label} />
                {item.status === 'uploading' || item.status === 'queued' ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Pause ${item.name}`} onClick={() => pause(item.id)}>
                        <PauseIcon aria-hidden />
                    </Button>
                ) : null}
                {item.status === 'paused' ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Resume ${item.name}`} onClick={() => resume(item.id)}>
                        <PlayIcon aria-hidden />
                    </Button>
                ) : null}
                {item.status === 'failed' ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Retry ${item.name}`} onClick={() => retry(item.id)}>
                        <RotateCwIcon aria-hidden />
                    </Button>
                ) : null}
                {item.status === 'needs_file' ? (
                    <>
                        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                            Re-select
                        </Button>
                        <input
                            ref={fileRef}
                            type="file"
                            className="sr-only"
                            tabIndex={-1}
                            onChange={(event) => {
                                const file = event.target.files?.[0]
                                event.target.value = ''
                                if (file) void reattach(item.id, file)
                            }}
                        />
                    </>
                ) : null}
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
            {item.status === 'uploading' || item.status === 'paused' || item.status === 'needs_file' ? (
                <div className="flex items-center gap-2">
                    <Progress value={percent} aria-label={`${item.name} upload progress`} className="flex-1" />
                    <span className="text-mono text-muted-foreground">{percent}%</span>
                </div>
            ) : null}
        </li>
    )
}

/** Per-file progress for every upload in the session. */
export function UploadList() {
    const items = useUploadItems()
    const total = items.filter((item) => item.status === 'uploading' || item.status === 'queued' || item.status === 'paused')
    if (items.length === 0) return null
    const bytes = total.reduce((sum, item) => sum + item.size, 0)
    const overall = bytes ? Math.round((total.reduce((sum, item) => sum + item.size * item.progress, 0) / bytes) * 100) : null
    return (
        <>
        {overall !== null ? (
            <div className="flex items-center gap-2 pb-4">
                <Progress value={overall} aria-label="Overall upload progress" className="flex-1" />
                <span className="text-mono text-muted-foreground">{`${overall}% of ${formatBytes(bytes)}`}</span>
            </div>
        ) : null}
        <ul className="flex flex-col gap-4" aria-live="polite">
            {items.map((item) => (
                <UploadRow key={item.id} item={item} />
            ))}
        </ul>
        </>
    )
}
