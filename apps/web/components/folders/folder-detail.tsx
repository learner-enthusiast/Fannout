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
import { InfiniteList } from '~/components/infinite-list'
import { useDeleteFolder } from '~/components/library/delete-actions'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'
import { removeFromInfiniteCache, restoreSnapshot } from '~/lib/optimistic'
import { useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'

import { AddMediaDialog } from './add-media-dialog'

type Folder = RouterOutputs['folders']['get']
type Item = RouterOutputs['folders']['items']['items'][number]

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
                <MediaPreview type={media.type} url={media.previewUrl} thumbUrl={media.thumbUrl} alt={media.name} />
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

/** One role's items, 10 at a time. Moving = updateItem({position}) (server renumbers). */
function RoleSection({ folderId, role, title, count }: { folderId: string; role: FolderRole; title: string; count: number }) {
    const queryClient = useQueryClient()
    const utils = trpc.useUtils()
    const [drag, setDrag] = useState<string | null>(null)
    const [removing, setRemoving] = useState<Item | null>(null)
    const itemsQuery = trpc.folders.items.useInfiniteQuery({ folderId, role }, infiniteOptions({ staleTime: 0 }))
    const list = useInfiniteList(itemsQuery)

    const refresh = () => {
        void utils.folders.items.invalidate({ folderId })
        void utils.folders.get.invalidate({ folderId })
        void utils.folders.list.invalidate()
    }
    const updateItem = trpc.folders.updateItem.useMutation({ onSettled: refresh })
    const removeItem = trpc.folders.removeItem.useMutation({
        onMutate: async ({ mediaId }) => {
            const queryKey = getQueryKey(trpc.folders.items, { folderId, role }, 'infinite')
            await queryClient.cancelQueries({ queryKey })
            return { snapshot: removeFromInfiniteCache<Item>(queryClient, queryKey, (i) => i.mediaId === mediaId) }
        },
        onError: (error, _vars, context) => {
            if (context) restoreSnapshot(queryClient, context.snapshot)
            toast.error(normalizeTRPCError(error).message)
        },
        onSuccess: () => toast.success('Removed from folder'),
        onSettled: refresh,
    })
    const move = (from: number, to: number) => {
        const item = list.items[from]
        if (!item || to < 0 || to >= count || from === to) return
        updateItem.mutate({ folderId, mediaId: item.mediaId, position: to })
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>
                    {ROLE_LABEL[role]} · <span className="text-mono">{count}</span> · drag to reorder
                </CardDescription>
            </CardHeader>
            <CardContent>
                <InfiniteList
                    list={list}
                    getKey={(item) => item.mediaId}
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    skeleton={<Skeleton className="aspect-video w-full rounded-surface" />}
                    empty={<p className="text-meta">Nothing here anymore.</p>}
                    renderItem={(item, index) => (
                        <ItemCard
                            item={item}
                            index={index}
                            count={count}
                            dragging={drag === item.mediaId}
                            busy={updateItem.isPending}
                            onPrimary={() => updateItem.mutate({ folderId, mediaId: item.mediaId, isPrimary: !item.isPrimary })}
                            onMove={(to) => move(index, to)}
                            onRemove={() => setRemoving(item)}
                            dragHandlers={{
                                onDragStart: (event) => {
                                    setDrag(item.mediaId)
                                    event.dataTransfer.effectAllowed = 'move'
                                },
                                onDragEnd: () => setDrag(null),
                                // Reorder only within this role.
                                onDragOver: (event) => drag && event.preventDefault(),
                                onDrop: (event) => {
                                    event.preventDefault()
                                    if (drag) move(list.items.findIndex((i) => i.mediaId === drag), index)
                                    setDrag(null)
                                },
                            }}
                        />
                    )}
                />
            </CardContent>
            <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => !open && setRemoving(null)}
                title={`Remove “${removing?.media.name ?? 'this item'}” from the folder?`}
                description="It stays in your media library."
                confirmLabel="Remove From Folder"
                onConfirm={() => {
                    if (removing) removeItem.mutate({ folderId, mediaId: removing.mediaId })
                }}
            />
        </Card>
    )
}

export function FolderDetailView({ folderId }: { folderId: string }) {
    const router = useRouter()
    const [editing, setEditing] = useState(false)
    const [adding, setAdding] = useState(false)
    const query = trpc.folders.get.useQuery({ folderId }, { staleTime: 0 })
    const deleteFolder = useDeleteFolder({ onDeleted: () => router.push('/media/folders') })

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
    const sections = ROLE_SECTIONS.filter((section) => (folder.roleCounts[section.role] ?? 0) > 0)

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
                        <Button
                            variant="destructive"
                            leftIcon={<Trash2Icon aria-hidden />}
                            onClick={() => deleteFolder.request({ id: folder.id, name: folder.name, itemCount: folder.itemCount })}
                        >
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
                sections.map(({ role, title }) => (
                    <RoleSection key={role} folderId={folderId} role={role} title={title} count={folder.roleCounts[role] ?? 0} />
                ))
            )}

            <AddMediaDialog folderId={folderId} open={adding} onOpenChange={setAdding} />
            {deleteFolder.dialog}
        </>
    )
}
