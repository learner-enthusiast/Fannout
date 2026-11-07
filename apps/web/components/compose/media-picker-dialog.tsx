'use client'

import { CheckIcon, FolderIcon, SearchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import type { MediaLite } from '~/lib/compose'
import { formatDuration } from '~/lib/media-format'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'
import { InfiniteList } from '~/components/infinite-list'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'

const TYPE_NOUN = { video: 'videos', image: 'images', json: 'JSON files', subtitle: 'subtitle files' } as const

/**
 * Pick media from the library or a folder. `multiple` keeps click order.
 * Choosing a folder (folders tab) calls `onFolder` so the composer can fill
 * video / thumbnail / photos from the folder's roles.
 */
export function MediaPickerDialog({
    open,
    onOpenChange,
    type,
    multiple = false,
    title,
    initial = [],
    onPick,
    onFolder,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    type: 'video' | 'image' | 'json' | 'subtitle'
    multiple?: boolean
    title: string
    initial?: MediaLite[]
    onPick: (media: MediaLite[]) => void
    onFolder?: (folderId: string) => void
}) {
    const [query, setQuery] = useState('')
    const q = useDebouncedValue(query.trim())
    const [picked, setPicked] = useState<MediaLite[]>(initial)
    useEffect(() => {
        if (open) setPicked(initial)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when (re)opened
    }, [open])

    const [libraryRoot, setLibraryRoot] = useState<HTMLDivElement | null>(null)
    const [foldersRoot, setFoldersRoot] = useState<HTMLDivElement | null>(null)
    const mediaQuery = trpc.media.list.useInfiniteQuery({ type, ...(q ? { q } : {}) }, infiniteOptions({ enabled: open, staleTime: 0 }))
    const list = useInfiniteList(mediaQuery)
    const foldersQuery = trpc.folders.list.useInfiniteQuery({ ...(q ? { q } : {}) }, infiniteOptions({ enabled: open && Boolean(onFolder) }))
    const folders = useInfiniteList(foldersQuery)

    const toggle = (item: MediaLite) => {
        if (!multiple) return setPicked([item])
        setPicked((current) =>
            current.some((m) => m.id === item.id) ? current.filter((m) => m.id !== item.id) : [...current, item]
        )
    }

    const search = (
        <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
                size="sm"
                type="search"
                aria-label="Search by name"
                placeholder="Search by name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="ps-9"
            />
        </div>
    )

    const library = (
        <div ref={setLibraryRoot} className="max-h-80 overflow-y-auto">
            <InfiniteList
                list={list}
                root={libraryRoot}
                getKey={(item) => item.id}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                skeletonCount={8}
                skeleton={<Skeleton className="aspect-video w-full rounded-control" />}
                empty={<p className="py-8 text-center text-meta">No {TYPE_NOUN[type]}{q ? ' match' : ' yet'}.</p>}
                renderItem={(item) => {
                    const index = picked.findIndex((m) => m.id === item.id)
                    return (
                        <li>
                            <button
                                type="button"
                                aria-pressed={index >= 0}
                                disabled={item.status !== 'ready'}
                                onClick={() => toggle(item)}
                                className={cn(
                                    'relative flex w-full flex-col overflow-hidden rounded-control border-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                                    index >= 0 ? 'border-primary' : 'border-transparent'
                                )}
                            >
                                <MediaPreview type={item.type} url={item.url} alt={item.name} />
                                <span className="truncate px-2 pt-1 text-meta">{item.name}</span>
                                <span className="px-2 pb-1 text-mono text-muted-foreground">
                                    {item.status !== 'ready'
                                        ? 'Processing…'
                                        : item.type === 'video' || item.type === 'subtitle'
                                          ? formatDuration(item.durationSeconds)
                                          : item.type === 'image'
                                            ? `${item.width ?? '?'}×${item.height ?? '?'}`
                                            : 'JSON'}
                                </span>
                                {index >= 0 ? (
                                    <span className="absolute top-2 end-2 flex size-6 items-center justify-center rounded-full bg-primary text-mono text-primary-foreground">
                                        {multiple ? index + 1 : <CheckIcon aria-hidden className="size-4" />}
                                    </span>
                                ) : null}
                            </button>
                        </li>
                    )
                }}
            />
        </div>
    )

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {multiple ? 'Click in the order you want them to appear.' : 'Pick one.'}
                        {onFolder ? ' Or pick a folder to fill everything from it.' : ''}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">{search}</div>
                    <UploadButton variant="secondary" size="sm" />
                </div>
                {onFolder ? (
                    <Tabs defaultValue="library">
                        <TabsList>
                            <TabsTrigger value="library">Library</TabsTrigger>
                            <TabsTrigger value="folders">Folders</TabsTrigger>
                        </TabsList>
                        <TabsContent value="library" className="pt-4">
                            {library}
                        </TabsContent>
                        <TabsContent value="folders" className="pt-4">
                            <div ref={setFoldersRoot} className="max-h-80 overflow-y-auto">
                                <InfiniteList
                                    list={folders}
                                    root={foldersRoot}
                                    getKey={(folder) => folder.id}
                                    className="flex flex-col gap-1"
                                    skeleton={<Skeleton className="h-10 w-full rounded-control" />}
                                    empty={<p className="py-8 text-center text-meta">No folders found.</p>}
                                    renderItem={(folder) => (
                                        <li>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onFolder?.(folder.id)
                                                    onOpenChange(false)
                                                }}
                                                className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-start outline-none transition-colors duration-fast ease-out hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-card"
                                            >
                                                <FolderIcon aria-hidden className="size-4 text-muted-foreground" />
                                                <span className="min-w-0 flex-1 truncate text-foreground">{folder.name}</span>
                                                <span className="text-mono text-muted-foreground">{folder.itemCount}</span>
                                            </button>
                                        </li>
                                    )}
                                />
                            </div>
                        </TabsContent>
                    </Tabs>
                ) : (
                    library
                )}
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        disabled={picked.length === 0}
                        onClick={() => {
                            onPick(picked)
                            onOpenChange(false)
                        }}
                    >
                        {multiple ? `Use ${picked.length} Selected` : 'Use Selected'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
