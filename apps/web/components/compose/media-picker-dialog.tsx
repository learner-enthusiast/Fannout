'use client'

import { CheckIcon, FolderIcon, SearchIcon, UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'

import { MediaPreview } from '~/components/media/media-preview'
import { Button } from '~/components/ui/button'
import { Dropzone } from '~/components/uploads/dropzone'
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
import { useMediaQuery } from '~/hooks/use-media-query'

const TYPE_NOUN = { video: 'videos', image: 'images', json: 'JSON files', subtitle: 'subtitle files' } as const

/** Native file-explorer filter per slot type (mobile: images/videos open the camera roll). */
export const ACCEPT = {
    video: 'video/*',
    image: 'image/*',
    json: 'application/json,.json',
    subtitle: '.srt,.vtt,text/vtt,application/x-subrip',
} as const

const STATUS_LABEL: Partial<Record<MediaLite['status'], string>> = {
    uploading: 'Uploading…',
    uploaded: 'Processing…',
    processing: 'Processing…',
    failed: 'Failed',
}

/**
 * The one picker for every compose slot. "Upload" (default): drop files or
 * open the file explorer — choosing files closes the popup at once and hands
 * them to `onFiles` (they upload in the background). "Library": existing
 * media with multi-select (shift-click selects a range). "Folders" (when
 * `onFolder` is set) fills video / thumbnail / photos from a folder's roles.
 */
export function MediaPickerDialog({
    open,
    onOpenChange,
    type,
    multiple = false,
    title,
    initial = [],
    onPick,
    onFiles,
    onFolder,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    type: 'video' | 'image' | 'json' | 'subtitle'
    multiple?: boolean
    title: string
    initial?: MediaLite[]
    onPick: (media: MediaLite[]) => void
    /** Local files picked in the Upload tab (or pasted). The popup is already closing. */
    onFiles?: (files: File[]) => void
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

    const wide = useMediaQuery('(min-width: 640px)')

    const coarse = useMediaQuery('(pointer: coarse)')
    const [tab, setTab] = useState<string>(onFiles ? 'upload' : 'library')
    useEffect(() => {
        if (open) setTab(onFiles ? 'upload' : 'library')
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when (re)opened
    }, [open])

    const handFiles = (files: File[]) => {
        if (!onFiles || files.length === 0) return
        onOpenChange(false)
        onFiles(multiple ? files : files.slice(0, 1))
    }

    // Shift-click selects everything between the last click and this one (library order).
    const anchor = useRef<number | null>(null)
    const toggle = (item: MediaLite, index: number, event: MouseEvent) => {
        if (!multiple) return setPicked([item])
        if (event.shiftKey && anchor.current !== null) {
            const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
            const range = list.items.slice(from, to + 1).filter((m) => m.status !== 'failed')
            setPicked((current) => [...current, ...range.filter((m) => !current.some((p) => p.id === m.id))])
        } else {
            setPicked((current) =>
                current.some((m) => m.id === item.id) ? current.filter((m) => m.id !== item.id) : [...current, item]
            )
        }
        anchor.current = index
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
                virtual={{ estimateSize: 150, columns: wide ? 4 : 2 }}
                skeletonCount={8}
                skeleton={<Skeleton className="aspect-video w-full rounded-control" />}
                empty={<p className="py-8 text-center text-meta">No {TYPE_NOUN[type]}{q ? ' match' : ' yet'}.</p>}
                renderItem={(item, position) => {
                    const index = picked.findIndex((m) => m.id === item.id)
                    return (
                        <li>
                            <button
                                type="button"
                                aria-pressed={index >= 0}
                                disabled={item.status === 'failed'}
                                onClick={(event) => toggle(item, position, event)}
                                className={cn(
                                    'relative flex w-full flex-col overflow-hidden rounded-control border-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                                    index >= 0 ? 'border-primary' : 'border-transparent'
                                )}
                            >
                                <MediaPreview type={item.type} url={item.url} thumbUrl={item.thumbUrl} alt={item.name} />
                                <span className="truncate px-2 pt-1 text-meta">{item.name}</span>
                                <span className="px-2 pb-1 text-mono text-muted-foreground">
                                    {item.status !== 'ready'
                                        ? (STATUS_LABEL[item.status] ?? 'Processing…')
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
                                ) : multiple ? (
                                    <span aria-hidden className="absolute top-2 end-2 size-6 rounded-full border-2 border-border bg-popover" />
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
            <DialogContent
                className="sm:max-w-3xl"
                onPaste={(event) => {
                    const files = Array.from(event.clipboardData.files)
                    if (files.length && onFiles) {
                        event.preventDefault()
                        handFiles(files)
                    }
                }}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {onFiles ? 'Upload new files or add them from your library.' : multiple ? 'Click in the order you want them to appear.' : 'Pick one.'}
                        {multiple ? ' Shift-click selects a range.' : ''}
                        {onFolder ? ' Or pick a folder to fill everything from it.' : ''}
                    </DialogDescription>
                </DialogHeader>
                <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
                    <TabsList>
                        {onFiles ? <TabsTrigger value="upload">Upload</TabsTrigger> : null}
                        <TabsTrigger value="library">Library</TabsTrigger>
                        {onFolder ? <TabsTrigger value="folders">Folders</TabsTrigger> : null}
                    </TabsList>
                    {onFiles ? (
                        <TabsContent value="upload" className="pt-4">
                            {coarse ? (
                                <UploadPicker accept={ACCEPT[type]} multiple={multiple} onFiles={handFiles} />
                            ) : (
                                <Dropzone
                                    accept={ACCEPT[type]}
                                    multiple={multiple}
                                    title={multiple ? `Drop ${TYPE_NOUN[type]} here` : `Drop ${type === 'image' ? 'an image' : type === 'video' ? 'a video' : `a ${type === 'json' ? 'JSON' : 'subtitle'} file`} here`}
                                    helper="Or choose from your computer, or paste. Uploads start right away and keep going while you write."
                                    onFiles={handFiles}
                                />
                            )}
                        </TabsContent>
                    ) : null}
                    <TabsContent value="library" className="flex flex-col gap-4 pt-4">
                        {search}
                        {library}
                    </TabsContent>
                    {onFolder ? (
                        <TabsContent value="folders" className="flex flex-col gap-4 pt-4">
                            {search}
                            <div ref={setFoldersRoot} className="max-h-80 overflow-y-auto">
                                <InfiniteList
                                    list={folders}
                                    root={foldersRoot}
                                    getKey={(folder) => folder.id}
                                    className="flex flex-col gap-1"
                                    virtual={{ estimateSize: 40, gap: 4 }}
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
                    ) : null}
                </Tabs>
                {tab === 'library' ? (
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
                            {multiple ? `Add ${picked.length}` : 'Add'}
                        </Button>
                    </DialogFooter>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}

/** Touch devices: no drop zone, just the button (opens the camera roll for images/videos). */
function UploadPicker({ accept, multiple, onFiles }: { accept: string; multiple: boolean; onFiles: (files: File[]) => void }) {
    const inputRef = useRef<HTMLInputElement>(null)
    return (
        <div className="flex flex-col items-center gap-4 py-6">
            <Button variant="primary" leftIcon={<UploadIcon aria-hidden />} onClick={() => inputRef.current?.click()}>
                Choose Files
            </Button>
            <p className="text-meta">Uploads start right away and keep going while you write.</p>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                multiple={multiple}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    event.target.value = ''
                    onFiles(files)
                }}
            />
        </div>
    )
}
