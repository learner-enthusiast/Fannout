'use client'

import { UploadCloudIcon } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

/**
 * Drag-and-drop area with a "Choose Files" button (keyboard accessible).
 * Emits the selected files; validation happens in the upload provider.
 */
export function Dropzone({
    accept,
    multiple = true,
    title,
    helper,
    onFiles,
}: {
    accept: string
    multiple?: boolean
    title: string
    helper: string
    onFiles: (files: File[]) => void
}) {
    const inputRef = useRef<HTMLInputElement>(null)
    const helperId = useId()
    const [dragging, setDragging] = useState(false)

    return (
        <div
            onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                const list = Array.from(event.dataTransfer.files)
                if (list.length) onFiles(multiple ? list : list.slice(0, 1))
            }}
            className={cn(
                'flex flex-col items-center justify-center gap-4 rounded-surface border border-dashed border-border bg-card px-6 py-12 text-center transition-colors duration-fast ease-out',
                dragging && 'border-primary bg-accent'
            )}
        >
            <UploadCloudIcon aria-hidden className="size-6 text-muted-foreground" />
            <div className="flex flex-col gap-1">
                <p className="text-label text-foreground">{title}</p>
                <p id={helperId} className="text-meta">
                    {helper}
                </p>
            </div>
            <Button
                variant="secondary"
                aria-describedby={helperId}
                onClick={() => inputRef.current?.click()}
            >
                Choose Files
            </Button>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                multiple={multiple}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                    const list = Array.from(event.target.files ?? [])
                    event.target.value = ''
                    if (list.length) onFiles(list)
                }}
            />
        </div>
    )
}
