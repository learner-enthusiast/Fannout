'use client'

import { CheckIcon, ImagePlusIcon, SearchIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
    initialAssignments,
    missingLabel,
    RoleAssignments,
    toItems,
    type PickedMedia,
} from '~/components/media/add-to-folder-dialog'
import { MediaPreview } from '~/components/media/media-preview'
import { Button } from '~/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import type { FolderRole } from '~/lib/media-roles'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'

type Assignment = { mediaId: string; role: FolderRole; label: string }

/** Library picker with search: select media, set a role each, add to the folder. */
export function AddMediaDialog({
    folderId,
    existingIds,
    open,
    onOpenChange,
}: {
    folderId: string
    existingIds: string[]
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const utils = trpc.useUtils()
    const [query, setQuery] = useState('')
    const q = useDebouncedValue(query.trim())
    const [picked, setPicked] = useState<PickedMedia[]>([])
    const [assignments, setAssignments] = useState<Assignment[]>([])

    const list = trpc.media.list.useInfiniteQuery(
        { limit: 12, ...(q ? { q } : {}) },
        { enabled: open, staleTime: 0, getNextPageParam: (last) => last.nextCursor ?? undefined }
    )
    const add = trpc.folders.addItems.useMutation({
        onSuccess: (folder) => {
            utils.folders.get.setData({ folderId }, folder)
            void utils.folders.list.invalidate()
            toast.success(picked.length === 1 ? 'Media added' : `${picked.length} items added`)
            setPicked([])
            setAssignments([])
            onOpenChange(false)
        },
    })

    const candidates = (list.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (item) => item.status !== 'failed' && !existingIds.includes(item.id)
    )

    const toggle = (item: PickedMedia) => {
        const isPicked = picked.some((p) => p.id === item.id)
        setPicked((current) => (isPicked ? current.filter((p) => p.id !== item.id) : [...current, item]))
        setAssignments((current) =>
            isPicked ? current.filter((a) => a.mediaId !== item.id) : [...current, ...initialAssignments([item])]
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Add media</DialogTitle>
                    <DialogDescription>Pick from your library, then check each item&rsquo;s role.</DialogDescription>
                </DialogHeader>
                <div className="relative">
                    <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        size="sm"
                        type="search"
                        aria-label="Search media"
                        placeholder="Search by name"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="ps-9"
                    />
                </div>
                {list.isPending ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {Array.from({ length: 8 }, (_, i) => (
                            <Skeleton key={i} className="aspect-video w-full rounded-control" />
                        ))}
                    </div>
                ) : candidates.length === 0 && !list.hasNextPage ? (
                    <p className="py-8 text-center text-meta">Nothing to add{q ? ' matches that search' : ''}.</p>
                ) : (
                    <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
                        {candidates.map((item) => {
                            const isPicked = picked.some((p) => p.id === item.id)
                            return (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        aria-pressed={isPicked}
                                        onClick={() =>
                                            toggle({
                                                id: item.id,
                                                name: item.name,
                                                type: item.type,
                                                orientation: item.orientation,
                                                originalFilename: item.originalFilename,
                                            })
                                        }
                                        className={cn(
                                            'relative flex w-full flex-col overflow-hidden rounded-control border-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            isPicked ? 'border-primary' : 'border-transparent'
                                        )}
                                    >
                                        <MediaPreview type={item.type} url={item.url} alt={item.name} />
                                        <span className="truncate px-2 py-1 text-meta">{item.name}</span>
                                        {isPicked ? (
                                            <span className="absolute top-2 end-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                                <CheckIcon aria-hidden className="size-4" />
                                            </span>
                                        ) : null}
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                )}
                {list.hasNextPage ? (
                    <Button variant="secondary" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                        Load More
                    </Button>
                ) : null}
                {picked.length > 0 ? (
                    <section className="flex flex-col gap-2" aria-label="Roles">
                        <h3 className="text-label text-foreground">Roles</h3>
                        <RoleAssignments media={picked} value={assignments} onChange={setAssignments} />
                    </section>
                ) : null}
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        leftIcon={<ImagePlusIcon aria-hidden />}
                        disabled={picked.length === 0 || missingLabel(assignments)}
                        loading={add.isPending}
                        onClick={() => add.mutate({ folderId, items: toItems(assignments) })}
                    >
                        {picked.length ? `Add ${picked.length} Selected` : 'Add Selected'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
