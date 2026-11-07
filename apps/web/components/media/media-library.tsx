'use client'

import { FolderPlusIcon, ImagesIcon, SearchIcon, UploadIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { RouterOutputs } from '@repo/trpc/client'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { EmptyState } from '~/components/ui/empty-state'
import { Input } from '~/components/ui/input'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '~/components/ui/select'
import { Skeleton } from '~/components/ui/skeleton'
import { Spinner } from '~/components/ui/spinner'
import { StatusBadge } from '~/components/ui/status-badge'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { normalizeTRPCError } from '~/lib/error'
import { formatDuration } from '~/lib/media-format'
import { ORIENTATION_LABEL, TYPE_LABEL, type MediaType, type Orientation } from '~/lib/media-roles'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'

import { AddToFolderDialog, type PickedMedia } from './add-to-folder-dialog'
import { InlineRename } from './inline-rename'
import { OrientationBadge, TypeBadge } from './media-badges'
import { MediaPreview } from './media-preview'

type Media = RouterOutputs['media']['list']['items'][number]

const PAGE_SIZE = 24
const ALL = 'all'

function MediaTile({
    item,
    selected,
    onToggle,
}: {
    item: Media
    selected: boolean
    onToggle: (checked: boolean) => void
}) {
    return (
        <li
            className={cn(
                'relative flex flex-col overflow-hidden rounded-surface border bg-card transition-colors duration-fast ease-out',
                selected ? 'border-primary' : 'border-border hover:border-primary'
            )}
        >
            <Link
                href={`/media/${item.id}`}
                className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Open ${item.name}`}
            >
                <MediaPreview type={item.type} url={item.url} alt={item.name} />
            </Link>
            <span className="absolute top-2 start-2 flex rounded-control bg-popover p-1 shadow-float">
                <Checkbox
                    checked={selected}
                    onCheckedChange={(checked) => onToggle(checked === true)}
                    aria-label={`Select ${item.name}`}
                />
            </span>
            <div className="flex flex-col gap-2 p-4">
                <InlineRename mediaId={item.id} name={item.name} />
                <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={item.type} />
                    <OrientationBadge orientation={item.orientation} />
                    {item.durationSeconds && (item.type === 'video' || item.type === 'subtitle') ? (
                        <span className="text-mono text-muted-foreground">{formatDuration(item.durationSeconds)}</span>
                    ) : null}
                    {item.status !== 'ready' ? (
                        <StatusBadge status={item.status === 'uploaded' ? 'processing' : item.status} />
                    ) : null}
                </div>
            </div>
        </li>
    )
}

export function UploadButton() {
    return (
        <Button
            variant="primary"
            size="md"
            nativeButton={false}
            leftIcon={<UploadIcon aria-hidden />}
            render={<Link href="/media/upload" />}
        >
            Upload
        </Button>
    )
}

function FilterSelect<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string
    value: T | typeof ALL
    options: Record<T, string>
    onChange: (value: T | typeof ALL) => void
}) {
    return (
        <Select<string> value={value} onValueChange={(next) => next && onChange(next as T | typeof ALL)}>
            <SelectTrigger size="sm" aria-label={label}>
                <SelectValue>{(v: string) => (v === ALL ? `All ${label.toLowerCase()}s` : options[v as T])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    <SelectItem value={ALL}>{`All ${label.toLowerCase()}s`}</SelectItem>
                    {(Object.entries(options) as [T, string][]).map(([key, text]) => (
                        <SelectItem key={key} value={key}>
                            {text}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    )
}

/** Searchable, filterable media grid; select items to add them to a folder. */
export function MediaLibrary() {
    const [query, setQuery] = useState('')
    const q = useDebouncedValue(query.trim())
    const [type, setType] = useState<MediaType | typeof ALL>(ALL)
    const [orientation, setOrientation] = useState<Orientation | typeof ALL>(ALL)
    const [selected, setSelected] = useState<Map<string, PickedMedia>>(new Map())
    const [dialogOpen, setDialogOpen] = useState(false)

    const list = trpc.media.list.useInfiniteQuery(
        {
            limit: PAGE_SIZE,
            ...(q ? { q } : {}),
            ...(type !== ALL ? { type } : {}),
            ...(orientation !== ALL ? { orientation } : {}),
        },
        { staleTime: 0, getNextPageParam: (last) => last.nextCursor ?? undefined }
    )
    const sentinel = useInfiniteScroll({
        hasMore: Boolean(list.hasNextPage),
        loading: list.isFetchingNextPage,
        onLoadMore: () => void list.fetchNextPage(),
    })

    const toggle = (item: Media, checked: boolean) =>
        setSelected((current) => {
            const next = new Map(current)
            if (checked)
                next.set(item.id, {
                    id: item.id,
                    name: item.name,
                    type: item.type,
                    orientation: item.orientation,
                    originalFilename: item.originalFilename,
                })
            else next.delete(item.id)
            return next
        })
    const picked = useMemo(() => [...selected.values()], [selected])
    const filtered = Boolean(q) || type !== ALL || orientation !== ALL
    const items = list.data?.pages.flatMap((page) => page.items) ?? []

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 sm:max-w-sm">
                    <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        size="sm"
                        type="search"
                        aria-label="Search media by name"
                        placeholder="Search by name"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="ps-9"
                    />
                </div>
                <FilterSelect label="Type" value={type} options={TYPE_LABEL} onChange={setType} />
                <FilterSelect label="Orientation" value={orientation} options={ORIENTATION_LABEL} onChange={setOrientation} />
                {picked.length > 0 ? (
                    <div className="ms-auto flex items-center gap-2" role="toolbar" aria-label="Selection">
                        <span className="text-meta">
                            <span className="text-mono">{picked.length}</span> selected
                        </span>
                        <Button variant="ghost" size="sm" leftIcon={<XIcon aria-hidden />} onClick={() => setSelected(new Map())}>
                            Clear
                        </Button>
                        <Button variant="secondary" size="sm" leftIcon={<FolderPlusIcon aria-hidden />} onClick={() => setDialogOpen(true)}>
                            Add to Folder
                        </Button>
                    </div>
                ) : null}
            </div>

            {list.isPending ? (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy>
                    {Array.from({ length: 8 }, (_, i) => (
                        <li key={i} className="flex flex-col gap-2">
                            <Skeleton className="aspect-video w-full rounded-surface" />
                            <Skeleton className="h-4 w-2/3" />
                        </li>
                    ))}
                </ul>
            ) : list.isError ? (
                <Alert variant="destructive">
                    <AlertTitle>Could not load your media</AlertTitle>
                    <AlertDescription>{normalizeTRPCError(list.error).message}</AlertDescription>
                </Alert>
            ) : items.length === 0 ? (
                filtered ? (
                    <EmptyState icon={SearchIcon} title="No matches" description="Try another name or clear the filters." />
                ) : (
                    <EmptyState
                        icon={ImagesIcon}
                        title="No media yet"
                        description="Upload videos, images, subtitles and social JSON to organise them into folders."
                        actions={<UploadButton />}
                    />
                )
            ) : (
                <>
                    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {items.map((item) => (
                            <MediaTile
                                key={item.id}
                                item={item}
                                selected={selected.has(item.id)}
                                onToggle={(checked) => toggle(item, checked)}
                            />
                        ))}
                    </ul>
                    <div ref={sentinel} aria-hidden className="h-1" />
                    {list.isFetchingNextPage ? (
                        <div className="flex justify-center">
                            <Spinner />
                        </div>
                    ) : null}
                </>
            )}
            <AddToFolderDialog
                media={picked}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onDone={() => setSelected(new Map())}
            />
        </div>
    )
}
