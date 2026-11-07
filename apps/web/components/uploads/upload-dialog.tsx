'use client'

import { UploadIcon } from 'lucide-react'
import { useState } from 'react'

import { MediaUpload } from '~/components/media/media-upload'
import { Button } from '~/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog'

/**
 * The one way to upload: a popup with the upload form. It closes as soon as
 * files join the background queue (progress stays in the header indicator).
 */
export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Upload media</DialogTitle>
                    <DialogDescription>Videos and images up to 5 GB; SRT/VTT subtitles and JSON up to 1 MB.</DialogDescription>
                </DialogHeader>
                <MediaUpload showQueue={false} onStarted={() => onOpenChange(false)} />
            </DialogContent>
        </Dialog>
    )
}

/** Button + upload popup. Primary on pages; secondary inside pickers. */
export function UploadButton({
    variant = 'primary',
    size = 'md',
    defaultOpen = false,
}: {
    variant?: 'primary' | 'secondary'
    size?: 'sm' | 'md'
    defaultOpen?: boolean
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <>
            <Button variant={variant} size={size} leftIcon={<UploadIcon aria-hidden />} onClick={() => setOpen(true)}>
                Upload
            </Button>
            <UploadDialog open={open} onOpenChange={setOpen} />
        </>
    )
}
