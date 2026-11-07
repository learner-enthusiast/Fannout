'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { ExternalLinkIcon, PencilIcon, RefreshCwIcon, RotateCcwIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ComposeFieldControl } from '~/components/compose/compose-field'
import { MediaPickerDialog } from '~/components/compose/media-picker-dialog'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog'
import { Skeleton } from '~/components/ui/skeleton'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import type { Capabilities } from '~/lib/compose'
import { normalizeTRPCError } from '~/lib/error'
import { trpc } from '~/trpc/client'

/** What a row/detail needs to show state and offer actions. */
export type ActionablePost = {
    id: string
    platform: string
    status: string
    postUrl: string | null
    externalStatus: string
    editStatus: string | null
    editErrorMessage: string | null
    lastEditedAt: Date | string | null
    deleteErrorCode: string | null
    deleteErrorMessage: string | null
}

/** Deleting… / Deleted / Delete failed / Editing… / Edited / Edit failed / Reconnect required. */
export function PostActionState({ post }: { post: ActionablePost }) {
    if (post.deleteErrorCode === 'reconnect_required') return <Badge variant="destructive">Reconnect required</Badge>
    if (post.status === 'deleting') return <Badge variant="warning">Deleting…</Badge>
    if (post.status === 'deleted') return <Badge variant="neutral">Deleted</Badge>
    if (post.deleteErrorCode) return <Badge variant="destructive">Delete failed</Badge>
    if (post.editStatus === 'editing') return <Badge variant="warning">Editing…</Badge>
    if (post.editStatus === 'failed') return <Badge variant="destructive">Edit failed</Badge>
    if (post.externalStatus === 'deleted_externally') return <Badge variant="neutral">Removed on platform</Badge>
    if (post.lastEditedAt) {
        return (
            <Badge variant="outline">
                Edited {formatDistanceToNowStrict(new Date(post.lastEditedAt), { addSuffix: true })}
            </Badge>
        )
    }
    return null
}

const IN_FLIGHT = ['queued', 'publishing', 'scheduled']

export function PostActions({
    post,
    capabilities,
    accountName,
    onChanged,
}: {
    post: ActionablePost
    capabilities: Capabilities | undefined
    accountName: string
    onChanged: () => void
}) {
    const [confirm, setConfirm] = useState<null | 'delete' | 'cancel'>(null)
    const [editing, setEditing] = useState(false)
    const [reposting, setReposting] = useState(false)
    const remove = trpc.posts.delete.useMutation()
    const edit = trpc.posts.update.useMutation()

    const runDelete = async () => {
        const result = await remove.mutateAsync({ postId: post.id })
        if (result.mode === 'manual') {
            toast.info(result.deleteNote ?? 'Delete it in the app', {
                action: result.postUrl ? { label: 'Open', onClick: () => window.open(result.postUrl!, '_blank', 'noopener') } : undefined,
            })
        } else if (result.mode === 'queued') toast.success('Deleting… you can leave this page')
        else if (result.mode === 'cancelled') toast.success('Cancelled')
        onChanged()
    }

    if (post.status === 'deleted' || post.status === 'cancelled' || post.status === 'deleting') return null

    if (IN_FLIGHT.includes(post.status) || post.status === 'failed') {
        return (
            <>
                <Button variant="secondary" size="sm" leftIcon={<XIcon aria-hidden />} onClick={() => setConfirm('cancel')}>
                    Cancel
                </Button>
                <ConfirmDialog
                    open={confirm === 'cancel'}
                    onOpenChange={(o) => !o && setConfirm(null)}
                    title={`Cancel the post to ${accountName}?`}
                    description="It hasn't been published, so nothing is removed from the platform."
                    confirmLabel="Cancel Post"
                    cancelLabel="Keep"
                    onConfirm={runDelete}
                />
            </>
        )
    }

    if (post.status !== 'published') return null
    const canDelete = capabilities?.supportsDelete ?? false
    const canEdit = (capabilities?.supportsEdit ?? false) && post.externalStatus === 'live'

    return (
        <>
            {post.editStatus === 'failed' ? (
                <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<RotateCcwIcon aria-hidden />}
                    loading={edit.isPending}
                    onClick={() => setEditing(true)}
                >
                    Retry Edit
                </Button>
            ) : null}
            {canEdit ? (
                <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<PencilIcon aria-hidden />}
                    disabled={post.editStatus === 'editing'}
                    onClick={() => setEditing(true)}
                >
                    Edit
                </Button>
            ) : (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button variant="secondary" size="sm" leftIcon={<RefreshCwIcon aria-hidden />} onClick={() => setReposting(true)} />
                        }
                    >
                        Delete &amp; Repost…
                    </TooltipTrigger>
                    <TooltipContent>{capabilities?.editNote ?? "This platform can't edit posts"}</TooltipContent>
                </Tooltip>
            )}
            {canDelete ? (
                <Button
                    variant="destructive"
                    size="sm"
                    leftIcon={<Trash2Icon aria-hidden />}
                    onClick={() => setConfirm('delete')}
                >
                    {post.deleteErrorCode ? 'Retry Delete' : 'Delete'}
                </Button>
            ) : post.postUrl ? (
                <Button
                    variant="secondary"
                    size="sm"
                    nativeButton={false}
                    leftIcon={<ExternalLinkIcon aria-hidden />}
                    render={<a href={post.postUrl} target="_blank" rel="noreferrer" />}
                >
                    {`Delete in ${capabilities?.label ?? 'the app'}`}
                </Button>
            ) : null}

            <ConfirmDialog
                open={confirm === 'delete'}
                onOpenChange={(o) => !o && setConfirm(null)}
                title={`Delete from ${accountName}?`}
                description={
                    <span className="flex flex-col gap-2">
                        <span>The post is removed from {capabilities?.label}. Your media stays in the library.</span>
                        {capabilities?.deleteNote ? <span>{capabilities.deleteNote}</span> : null}
                    </span>
                }
                confirmLabel="Delete Post"
                onConfirm={runDelete}
            />
            {editing && capabilities ? (
                <EditPostDialog postId={post.id} capabilities={capabilities} onClose={() => setEditing(false)} onSaved={onChanged} />
            ) : null}
            {reposting ? <RepostDialog postId={post.id} capabilities={capabilities} onClose={() => setReposting(false)} onDone={onChanged} /> : null}
        </>
    )
}

/** Only the platform's editableFields, with the same controls/counters as Compose. */
function EditPostDialog({
    postId,
    capabilities,
    onClose,
    onSaved,
}: {
    postId: string
    capabilities: Capabilities
    onClose: () => void
    onSaved: () => void
}) {
    const detail = trpc.posts.get.useQuery({ postId }, { staleTime: 0 })
    const [values, setValues] = useState<Record<string, unknown> | null>(null)
    const [thumbPicker, setThumbPicker] = useState(false)
    const [thumbnail, setThumbnail] = useState<{ id: string; name: string } | null>(null)
    const [issues, setIssues] = useState<{ field: string; message: string }[]>([])
    const update = trpc.posts.update.useMutation({ onError: () => undefined })

    const fields = capabilities.fields.filter((f) => capabilities.editableFields.includes(f.name))
    const current = values ?? detail.data?.input ?? {}

    const save = async () => {
        const original = detail.data?.input ?? {}
        const changes = Object.fromEntries(
            fields
                .filter((f) => JSON.stringify(current[f.name] ?? null) !== JSON.stringify(original[f.name] ?? null))
                .map((f) => [f.name, current[f.name] ?? null])
        )
        if (thumbnail) changes.thumbnail = thumbnail.id
        try {
            const result = await update.mutateAsync({ postId, changes })
            toast.success(result.mode === 'noop' ? 'Nothing changed' : 'Saving changes… you can leave this page')
            onSaved()
            onClose()
        } catch (error) {
            const { message, details } = normalizeTRPCError(error)
            setIssues((details as { issues?: { field: string; message: string }[] } | undefined)?.issues ?? [])
            toast.error(message)
        }
    }

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Edit post</DialogTitle>
                    <DialogDescription>{capabilities.editNote}</DialogDescription>
                </DialogHeader>
                {detail.isPending ? (
                    <Skeleton className="h-40 w-full" />
                ) : (
                    <div className="flex max-h-96 flex-col gap-4 overflow-y-auto">
                        {fields.map((field) => (
                            <ComposeFieldControl
                                key={field.name}
                                field={field}
                                value={current[field.name]}
                                error={issues.find((i) => i.field === field.name)?.message}
                                socialConnectionId={detail.data?.socialConnectionId ?? ''}
                                onChange={(value) => setValues({ ...current, [field.name]: value })}
                            />
                        ))}
                        {capabilities.editableFields.includes('thumbnail') ? (
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-label text-foreground">Thumbnail</span>
                                <Button variant="secondary" size="sm" onClick={() => setThumbPicker(true)}>
                                    {thumbnail ? thumbnail.name : 'Replace Thumbnail'}
                                </Button>
                            </div>
                        ) : null}
                        {issues.filter((i) => !fields.some((f) => f.name === i.field)).map((i) => (
                            <Alert key={i.field + i.message} variant="destructive">
                                <AlertDescription>{i.message}</AlertDescription>
                            </Alert>
                        ))}
                    </div>
                )}
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" loading={update.isPending} onClick={() => void save()}>
                        Save Changes
                    </Button>
                </DialogFooter>
                <MediaPickerDialog
                    open={thumbPicker}
                    onOpenChange={setThumbPicker}
                    type="image"
                    title="Choose a thumbnail"
                    onPick={([item]) => item && setThumbnail({ id: item.id, name: item.name })}
                />
            </DialogContent>
        </Dialog>
    )
}

/** New post with the same media; optionally delete the original once it's live. */
function RepostDialog({
    postId,
    capabilities,
    onClose,
    onDone,
}: {
    postId: string
    capabilities: Capabilities | undefined
    onClose: () => void
    onDone: () => void
}) {
    const [deleteOriginal, setDeleteOriginal] = useState(false)
    const repost = trpc.posts.repost.useMutation()
    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete &amp; repost</DialogTitle>
                    <DialogDescription>{capabilities?.editNote ?? 'This platform can’t edit posts.'} Fannout publishes a new post with the same media and text.</DialogDescription>
                </DialogHeader>
                <label className="flex items-start gap-2 text-foreground">
                    <Checkbox checked={deleteOriginal} onCheckedChange={(v) => setDeleteOriginal(v === true)} />
                    <span className="flex flex-col gap-1">
                        <span className="text-label">Delete the original after reposting</span>
                        <span className="text-meta">Its likes, comments and shares are lost. Happens only after the new post is live.</span>
                    </span>
                </label>
                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        leftIcon={<RefreshCwIcon aria-hidden />}
                        loading={repost.isPending}
                        onClick={async () => {
                            await repost.mutateAsync({ postId, deleteOriginal })
                            toast.success('Reposting… you can leave this page')
                            onDone()
                            onClose()
                        }}
                    >
                        Repost
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
