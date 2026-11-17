'use client'

import { AlertTriangleIcon, CheckIcon, PauseIcon, WifiOffIcon } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '~/components/ui/popover'
import { formatBytes, formatDuration } from '~/lib/media-format'
import { cn } from '~/lib/utils'

import { useUploadActions, useUploadForMedia, type UploadItem } from './upload-provider'

const STATUS_TEXT: Record<UploadItem['status'], string> = {
    preparing: 'Reading file…',
    queued: 'Waiting to upload',
    uploading: 'Uploading',
    paused: 'Paused',
    needs_file: 'Paused: re-select the file',
    processing: 'Processing',
    ready: 'Ready',
    failed: 'Failed',
    cancelled: 'Cancelled',
}

function describe(item: UploadItem): string {
    if (item.status === 'paused' && item.pausedBy === 'offline') return 'Connection lost, will resume automatically'
    if (item.status === 'failed' || item.status === 'needs_file') return item.error ?? STATUS_TEXT[item.status]
    return STATUS_TEXT[item.status]
}

/** SVG ring; `value` null = indeterminate (spins). */
function Ring({ value }: { value: number | null }) {
    const r = 14
    const c = 2 * Math.PI * r
    return (
        <svg viewBox="0 0 32 32" className={cn('size-8 -rotate-90', value === null && 'animate-spin')} aria-hidden>
            <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" className="stroke-muted" />
            <circle
                cx="16"
                cy="16"
                r={r}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                className="stroke-primary transition-all duration-fast ease-out"
                strokeDasharray={c}
                strokeDashoffset={value === null ? c * 0.75 : c * (1 - value)}
            />
        </svg>
    )
}

/**
 * Upload state of one slot item: a progress ring while it uploads, a check
 * when ready. Tap for details (size, speed, time left) and controls. Only this
 * component subscribes to progress, so the compose page never re-renders on a tick.
 * `fallbackStatus` covers media uploaded elsewhere (another tab / session).
 */
export function UploadRing({ mediaId, fallbackStatus }: { mediaId: string; fallbackStatus?: string }) {
    const item = useUploadForMedia(mediaId)
    const { pause, resume, retry, cancel, reattach } = useUploadActions()
    const fileRef = useRef<HTMLInputElement>(null)
    const [open, setOpen] = useState(false)

    if (!item) {
        if (!fallbackStatus || fallbackStatus === 'ready') return null
        return (
            <span className="absolute bottom-1 start-1 flex items-center gap-1 rounded-control bg-popover px-1 text-mono text-foreground">
                {fallbackStatus === 'failed' ? <AlertTriangleIcon aria-hidden className="size-3 text-destructive" /> : null}
                {fallbackStatus === 'failed' ? 'Failed' : fallbackStatus === 'uploading' ? 'Uploading' : 'Processing'}
            </span>
        )
    }
    if (item.status === 'cancelled') return null

    const percent = Math.round(item.progress * 100)
    const indeterminate = item.status === 'preparing' || item.status === 'processing'
    const icon =
        item.status === 'ready' ? (
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <CheckIcon aria-hidden className="size-4" />
            </span>
        ) : item.status === 'failed' || item.status === 'needs_file' ? (
            <span className="flex size-8 items-center justify-center rounded-full bg-popover text-destructive">
                <AlertTriangleIcon aria-hidden className="size-4" />
            </span>
        ) : (
            <span className="relative flex size-8 items-center justify-center rounded-full bg-popover">
                <Ring value={indeterminate ? null : item.progress} />
                <span className="absolute inset-0 flex items-center justify-center text-mono text-foreground">
                    {item.status === 'paused' ? (
                        item.pausedBy === 'offline' ? <WifiOffIcon aria-hidden className="size-3" /> : <PauseIcon aria-hidden className="size-3" />
                    ) : indeterminate ? null : (
                        percent
                    )}
                </span>
            </span>
        )

    return (
        <span className="absolute bottom-1 start-1">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    render={
                        <button
                            type="button"
                            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`${item.name}: ${describe(item)}${item.status === 'uploading' ? ` ${percent}%` : ''}`}
                        />
                    }
                >
                    {icon}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72">
                    <PopoverHeader>
                        <PopoverTitle className="truncate">{item.name}</PopoverTitle>
                    </PopoverHeader>
                    <dl className="grid grid-cols-2 gap-1 text-meta">
                        <dt>Status</dt>
                        <dd className="text-foreground">{describe(item)}</dd>
                        <dt>Size</dt>
                        <dd className="text-foreground">{formatBytes(item.size)}</dd>
                        {item.status === 'uploading' ? (
                            <>
                                <dt>Sent</dt>
                                <dd className="text-foreground">{percent}%</dd>
                                <dt>Speed</dt>
                                <dd className="text-foreground">{item.speed ? `${formatBytes(item.speed)}/s` : '—'}</dd>
                                <dt>Time left</dt>
                                <dd className="text-foreground">{item.etaSeconds != null ? formatDuration(item.etaSeconds) : '—'}</dd>
                            </>
                        ) : null}
                        {item.reused ? (
                            <>
                                <dt>Upload</dt>
                                <dd className="text-foreground">Already in your library</dd>
                            </>
                        ) : null}
                    </dl>
                    <div className="flex flex-wrap justify-end gap-2 pt-2">
                        {item.status === 'uploading' || item.status === 'queued' ? (
                            <Button variant="secondary" size="sm" onClick={() => pause(item.id)}>
                                Pause
                            </Button>
                        ) : null}
                        {item.status === 'paused' ? (
                            <Button variant="secondary" size="sm" onClick={() => resume(item.id)}>
                                Resume
                            </Button>
                        ) : null}
                        {item.status === 'failed' ? (
                            <Button variant="secondary" size="sm" onClick={() => retry(item.id)}>
                                Retry
                            </Button>
                        ) : null}
                        {item.status === 'needs_file' ? (
                            <>
                                <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
                                    Re-select File
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
                        {['preparing', 'queued', 'uploading', 'paused', 'needs_file'].includes(item.status) ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setOpen(false)
                                    cancel(item.id)
                                }}
                            >
                                Cancel Upload
                            </Button>
                        ) : null}
                    </div>
                </PopoverContent>
            </Popover>
        </span>
    )
}

/**
 * Drop files straight onto a compose slot (no popup). Internal drags (photo
 * reordering) carry no files and pass through untouched.
 */
export function SlotDropTarget({
    onFiles,
    label,
    className,
    children,
}: {
    onFiles: (files: File[]) => void
    label: string
    className?: string
    children: ReactNode
}) {
    const [over, setOver] = useState(false)
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files')
    return (
        <div
            aria-label={label}
            onDragOver={(event) => {
                if (!hasFiles(event)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                setOver(true)
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
            }}
            onDrop={(event) => {
                if (!hasFiles(event)) return
                event.preventDefault()
                setOver(false)
                const files = Array.from(event.dataTransfer.files)
                if (files.length) onFiles(files)
            }}
            className={cn('rounded-surface transition-colors duration-fast ease-out', over && 'bg-accent outline-dashed outline-2 outline-primary', className)}
        >
            {children}
        </div>
    )
}
