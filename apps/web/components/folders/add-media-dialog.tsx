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
import { UploadButton } from '~/components/uploads/upload-dialog'
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
import { InfiniteList } from '~/components/infinite-list'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'

type Assignment = { mediaId: string; role: FolderRole; label: string }

/** Library picker with search: select media, set a role each, add to the folder. */
export function AddMediaDialog({
    folderId,
    open,
    onOpenChange,
}: {
    folderId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const utils = trpc.useUtils()
    const [query, setQuery] = useState('')
    const q = useDebouncedValue(query.trim())
    const [picked, setPicked] = useState<PickedMedia[]>([])
    const [assignments, setAssignments] = useState<Assignment[]>([])

    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
    const mediaQuery = trpc.media.list.useInfiniteQuery({ ...(q ? { q } : {}) }, infiniteOptions({ enabled: open, staleTime: 0 }))
    const list = useInfiniteList(mediaQuery)
    const add = trpc.folders.addItems.useMutation({
        onSuccess: () => {
            void utils.folders.get.invalidate({ folderId })
            void utils.folders.items.invalidate({ folderId })
            void utils.folders.list.invalidate()
            toast.success(picked.length === 1 ? 'Media added' : `${picked.length} items added`)
            setPicked([])
            setAssignments([])
            onOpenChange(false)
        },
    })

    const toggle = (item: PickedMedia) => {
        const isPicked = picked.some((p) => p.id === item.id)
        setPicked((current) =>
            isPicked
                ? current.filter((p) => p.id !== item.id)
                : [...current, item]
        )
        setAssignments((current) =>
            isPicked
                ? current.filter((a) => a.mediaId !== item.id)
                : [...current, ...initialAssignments([item])]
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Add media</DialogTitle>
                    <DialogDescription>
                        Pick from your library, then check each item&rsquo;s
                        role.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                        <SearchIcon
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground"
                        />
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
                    <UploadButton variant="secondary" size="sm" />
                </div>
                <div ref={setScrollRoot} className="max-h-72 overflow-y-auto">
                    <InfiniteList
                        list={list}
                        root={scrollRoot}
                        getKey={(item) => item.id}
                        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                        skeletonCount={8}
                        skeleton={<Skeleton className="aspect-video w-full rounded-control" />}
                        empty={<p className="py-8 text-center text-meta">Nothing to add{q ? ' matches that search' : ''}.</p>}
                        renderItem={(item) => {
                            const isPicked = picked.some((p) => p.id === item.id)
                            return (
                                <li>
                                    <button
                                        type="button"
                                        aria-pressed={isPicked}
                                        disabled={item.status === 'failed'}
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
                                            'relative flex w-full flex-col overflow-hidden rounded-control border-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
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
                        }}
                    />
                </div>
                {picked.length > 0 ? (
                    <section className="flex flex-col gap-2" aria-label="Roles">
                        <h3 className="text-label text-foreground">Roles</h3>
                        <RoleAssignments
                            media={picked}
                            value={assignments}
                            onChange={setAssignments}
                        />
                    </section>
                ) : null}
                <DialogFooter>
                    <Button
                        variant="secondary"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        leftIcon={<ImagePlusIcon aria-hidden />}
                        disabled={
                            picked.length === 0 || missingLabel(assignments)
                        }
                        loading={add.isPending}
                        onClick={() =>
                            add.mutate({
                                folderId,
                                items: toItems(assignments),
                            })
                        }
                    >
                        {picked.length
                            ? `Add ${picked.length} Selected`
                            : 'Add Selected'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
