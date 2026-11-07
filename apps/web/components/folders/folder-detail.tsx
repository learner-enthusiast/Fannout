'use client'

import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ImagePlusIcon,
    PencilIcon,
    StarIcon,
    Trash2Icon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import type { RouterOutputs } from '@repo/trpc/client'
import { PageHeader } from '~/components/layout/page-header'
import { BackButton } from '~/components/media/media-detail'
import { OrientationBadge, TypeBadge } from '~/components/media/media-badges'
import { MediaPreview } from '~/components/media/media-preview'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import { EmptyState } from '~/components/ui/empty-state'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { StatusBadge } from '~/components/ui/status-badge'
import { Textarea } from '~/components/ui/textarea'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import { normalizeTRPCError } from '~/lib/error'
import { formatDuration } from '~/lib/media-format'
import { ROLE_LABEL, ROLE_SECTIONS, type FolderRole } from '~/lib/media-roles'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'

import { AddMediaDialog } from './add-media-dialog'

type Folder = RouterOutputs['folders']['get']
type Item = Folder['items'][number]

function IconAction({
    label,
    onClick,
    disabled,
    children,
}: {
    label: string
    onClick: () => void
    disabled?: boolean
    children: React.ReactNode
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} />}
            >
                {children}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}

/** Name/description editor shown in place of the header text. */
function EditDetails({ folder, onDone }: { folder: Folder; onDone: () => void }) {
    const utils = trpc.useUtils()
    const [name, setName] = useState(folder.name)
    const [description, setDescription] = useState(folder.description ?? '')
    const [error, setError] = useState<string>()
    const update = trpc.folders.update.useMutation({
        onSuccess: (next) => {
            utils.folders.get.setData({ folderId: folder.id }, next)
            void utils.folders.list.invalidate()
            toast.success('Folder updated')
            onDone()
        },
        onError: (err) => {
            const { code, message } = normalizeTRPCError(err)
            if (code === 'CONFLICT') setError(message)
        },
    })
    return (
        <Card>
            <CardContent>
                <form
                    className="flex max-w-form flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (!name.trim()) return setError('Enter a folder name')
                        update.mutate({ folderId: folder.id, name: name.trim(), description: description.trim() || null })
                    }}
                >
                    <FormField label="Name" required error={error}>
                        {(p) => (
                            <Input {...p} value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setError(undefined) }} />
                        )}
                    </FormField>
                    <FormField label="Description" counter={{ value: description, limit: 2000 }}>
                        {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}
                    </FormField>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={onDone}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" loading={update.isPending}>
                            Save Changes
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    )
}

function ItemCard({
    item,
    index,
    count,
    dragging,
    busy,
    onPrimary,
    onMove,
    onRemove,
    dragHandlers,
}: {
    item: Item
    index: number
    count: number
    dragging: boolean
    busy: boolean
    onPrimary: () => void
    onMove: (to: number) => void
    onRemove: () => void
    dragHandlers: React.HTMLAttributes<HTMLLIElement>
}) {
    const { media } = item
    return (
        <li
            draggable
            {...dragHandlers}
            className={cn(
                'flex cursor-grab flex-col overflow-hidden rounded-surface border border-border bg-background',
                dragging && 'opacity-50'
            )}
        >
            <Link href={`/media/${media.id}`} className="outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${media.name}`}>
                <MediaPreview type={media.type} url={media.previewUrl} alt={media.name} />
            </Link>
            <div className="flex flex-col gap-2 p-2">
                <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-label text-foreground">
                        {item.label ? `${item.label} · ` : ''}
                        {media.name}
                    </span>
                    {item.isPrimary ? (
                        <Badge variant="primary">
                            <StarIcon aria-hidden />
                            Primary
                        </Badge>
                    ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={media.type} />
                    <OrientationBadge orientation={media.orientation} />
                    {media.durationSeconds ? (
                        <span className="text-mono text-muted-foreground">{formatDuration(media.durationSeconds)}</span>
                    ) : null}
                    {media.status !== 'ready' ? (
                        <StatusBadge status={media.status === 'uploaded' ? 'processing' : media.status} />
                    ) : null}
                </div>
                <div className="flex items-center justify-end gap-1">
                    <IconAction label={item.isPrimary ? 'Unset primary' : 'Make primary'} disabled={busy} onClick={onPrimary}>
                        <StarIcon aria-hidden />
                    </IconAction>
                    <IconAction label="Move earlier" disabled={busy || index === 0} onClick={() => onMove(index - 1)}>
                        <ChevronLeftIcon aria-hidden />
                    </IconAction>
                    <IconAction label="Move later" disabled={busy || index === count - 1} onClick={() => onMove(index + 1)}>
                        <ChevronRightIcon aria-hidden />
                    </IconAction>
                    <IconAction label="Remove from folder" onClick={onRemove}>
                        <Trash2Icon aria-hidden />
                    </IconAction>
                </div>
            </div>
        </li>
    )
}

export function FolderDetailView({ folderId }: { folderId: string }) {
    const router = useRouter()
    const utils = trpc.useUtils()
    const [editing, setEditing] = useState(false)
    const [adding, setAdding] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [removing, setRemoving] = useState<Item | null>(null)
    const [drag, setDrag] = useState<{ role: FolderRole; mediaId: string } | null>(null)

    const query = trpc.folders.get.useQuery({ folderId }, { staleTime: 0 })
    const onFolder = (folder: Folder) => {
        utils.folders.get.setData({ folderId }, folder)
        void utils.folders.list.invalidate()
    }
    const reorder = trpc.folders.reorder.useMutation({
        onMutate: ({ role, mediaIds }) => {
            const current = utils.folders.get.getData({ folderId })
            if (!current) return
            const others = current.items.filter((item) => item.role !== role)
            const byId = new Map(current.items.map((item) => [item.mediaId, item]))
            const moved = mediaIds.map((id, position) => ({ ...byId.get(id)!, position }))
            utils.folders.get.setData({ folderId }, { ...current, items: [...others, ...moved] })
        },
        onSuccess: onFolder,
        onError: () => void utils.folders.get.invalidate({ folderId }),
    })
    const updateItem = trpc.folders.updateItem.useMutation({ onSuccess: onFolder })
    const removeItem = trpc.folders.removeItem.useMutation({
        onSuccess: (folder) => {
            onFolder(folder)
            toast.success('Removed from folder')
        },
    })
    const deleteFolder = trpc.folders.delete.useMutation({
        onSuccess: () => {
            void utils.folders.list.invalidate()
            toast.success('Folder deleted', { description: 'The media is still in your library.' })
            router.push('/media/folders')
        },
    })

    if (query.isPending) {
        return (
            <div className="flex flex-col gap-8" aria-busy>
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-48 w-full rounded-surface" />
            </div>
        )
    }
    if (query.isError) {
        const { code, message } = normalizeTRPCError(query.error)
        return (
            <>
                <PageHeader title="Folder" actions={<BackButton href="/media/folders" label="Back to Folders" />} />
                <Alert variant="destructive">
                    <AlertTitle>{code === 'NOT_FOUND' ? 'Folder not found' : 'Could not load this folder'}</AlertTitle>
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            </>
        )
    }

    const folder = query.data
    const byRole = (role: FolderRole) =>
        folder.items.filter((item) => item.role === role).sort((a, b) => a.position - b.position)
    const move = (role: FolderRole, from: number, to: number) => {
        const ids = byRole(role).map((item) => item.mediaId)
        if (to < 0 || to >= ids.length || from === to) return
        const [id] = ids.splice(from, 1)
        ids.splice(to, 0, id!)
        reorder.mutate({ folderId, role, mediaIds: ids })
    }
    const sections = ROLE_SECTIONS.filter((section) => byRole(section.role).length > 0)

    return (
        <>
            <PageHeader
                title={folder.name}
                description={folder.description ?? `${folder.itemCount} item${folder.itemCount === 1 ? '' : 's'}`}
                actions={
                    <>
                        <BackButton href="/media/folders" label="Back to Folders" />
                        <Button variant="ghost" leftIcon={<PencilIcon aria-hidden />} onClick={() => setEditing(true)}>
                            Edit
                        </Button>
                        <Button variant="destructive" leftIcon={<Trash2Icon aria-hidden />} onClick={() => setConfirmDelete(true)}>
                            Delete
                        </Button>
                        <Button variant="primary" leftIcon={<ImagePlusIcon aria-hidden />} onClick={() => setAdding(true)}>
                            Add Media
                        </Button>
                    </>
                }
            />
            {editing ? <EditDetails folder={folder} onDone={() => setEditing(false)} /> : null}

            {sections.length === 0 ? (
                <EmptyState
                    icon={ImagePlusIcon}
                    title="This folder is empty"
                    description="Add the video's main cuts, trailers, thumbnails, subtitles or social JSON."
                    actions={
                        <Button variant="primary" leftIcon={<ImagePlusIcon aria-hidden />} onClick={() => setAdding(true)}>
                            Add Media
                        </Button>
                    }
                />
            ) : (
                sections.map(({ role, title }) => {
                    const items = byRole(role)
                    return (
                        <Card key={role}>
                            <CardHeader>
                                <CardTitle>{title}</CardTitle>
                                <CardDescription>
                                    {ROLE_LABEL[role]} · <span className="text-mono">{items.length}</span> · drag to reorder
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={ROLE_LABEL[role]}>
                                    {items.map((item, index) => (
                                        <ItemCard
                                            key={item.mediaId}
                                            item={item}
                                            index={index}
                                            count={items.length}
                                            dragging={drag?.mediaId === item.mediaId}
                                            busy={reorder.isPending || updateItem.isPending}
                                            onPrimary={() =>
                                                updateItem.mutate({ folderId, mediaId: item.mediaId, isPrimary: !item.isPrimary })
                                            }
                                            onMove={(to) => move(role, index, to)}
                                            onRemove={() => setRemoving(item)}
                                            dragHandlers={{
                                                onDragStart: (event) => {
                                                    setDrag({ role, mediaId: item.mediaId })
                                                    event.dataTransfer.effectAllowed = 'move'
                                                },
                                                onDragEnd: () => setDrag(null),
                                                // Reorder only within the same role.
                                                onDragOver: (event) => drag?.role === role && event.preventDefault(),
                                                onDrop: (event) => {
                                                    event.preventDefault()
                                                    if (drag && drag.role === role) {
                                                        move(role, items.findIndex((i) => i.mediaId === drag.mediaId), index)
                                                    }
                                                    setDrag(null)
                                                },
                                            }}
                                        />
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    )
                })
            )}

            <AddMediaDialog
                folderId={folderId}
                existingIds={folder.items.map((item) => item.mediaId)}
                open={adding}
                onOpenChange={setAdding}
            />
            <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => !open && setRemoving(null)}
                title={`Remove ${removing?.media.name ?? 'this item'} from the folder?`}
                description="It stays in your media library."
                confirmLabel="Remove From Folder"
                onConfirm={async () => {
                    if (removing) await removeItem.mutateAsync({ folderId, mediaId: removing.mediaId })
                }}
            />
            <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={`Delete folder ${folder.name}?`}
                description="Only the folder is deleted. Its media stays in your library."
                confirmLabel="Delete Folder"
                onConfirm={async () => {
                    await deleteFolder.mutateAsync({ folderId })
                }}
            />
        </>
    )
}
