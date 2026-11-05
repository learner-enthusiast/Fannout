'use client'

import * as React from 'react'
import { TriangleAlertIcon } from 'lucide-react'

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'

/**
 * ConfirmDialog — REQUIRED before any destructive action (delete,
 * disconnect). Cancel on the left, destructive confirm on the right.
 * `onConfirm` may return a promise; the confirm button shows `loading` until
 * it settles, then the dialog closes.
 *
 * @example
 * <ConfirmDialog
 *   trigger={<Button variant="destructive">Delete Post</Button>}
 *   title="Delete this post?"
 *   description="It will be removed from every connected channel."
 *   confirmLabel="Delete Post"
 *   onConfirm={deletePost}
 * />
 */
export function ConfirmDialog({
    trigger,
    title,
    description,
    confirmLabel,
    cancelLabel = 'Cancel',
    onConfirm,
    open: openProp,
    onOpenChange,
}: {
    /** A <Button>. Rendered as the dialog trigger. */
    trigger?: React.ReactElement
    title: string
    description?: React.ReactNode
    /** Verb in Title Case, e.g. "Delete Post". */
    confirmLabel: string
    cancelLabel?: string
    onConfirm: () => void | Promise<void>
    open?: boolean
    onOpenChange?: (open: boolean) => void
}) {
    const [internalOpen, setInternalOpen] = React.useState(false)
    const [pending, setPending] = React.useState(false)
    const open = openProp ?? internalOpen
    const setOpen = (next: boolean) => {
        if (pending) return
        setInternalOpen(next)
        onOpenChange?.(next)
    }

    async function handleConfirm() {
        setPending(true)
        try {
            await onConfirm()
            setInternalOpen(false)
            onOpenChange?.(false)
        } finally {
            setPending(false)
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            {trigger ? <AlertDialogTrigger render={trigger} /> : null}
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    {description ? (
                        <AlertDialogDescription>
                            {description}
                        </AlertDialogDescription>
                    ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>
                        {cancelLabel}
                    </AlertDialogCancel>
                    <Button
                        variant="destructive"
                        loading={pending}
                        leftIcon={<TriangleAlertIcon aria-hidden />}
                        onClick={handleConfirm}
                    >
                        {confirmLabel}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
