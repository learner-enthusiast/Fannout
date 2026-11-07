'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { FolderIcon, FolderPlusIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import type { RouterOutputs } from '@repo/trpc/client'
import { InfiniteList } from '~/components/infinite-list'
import { CardMenu, cardMenuSlot, useDeleteFolder, useIsDeleting } from '~/components/library/delete-actions'
import { Button } from '~/components/ui/button'
import { EmptyState } from '~/components/ui/empty-state'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'

type Folder = RouterOutputs['folders']['list']['items'][number]

export function NewFolderPrimaryButton() {
    return (
        <Button
            variant="primary"
            nativeButton={false}
            leftIcon={<FolderPlusIcon aria-hidden />}
            render={<Link href="/media/folders/new" />}
        >
            New Folder
        </Button>
    )
}

function FolderCard({ folder, onDelete }: { folder: Folder; onDelete: () => void }) {
    const deleting = useIsDeleting(folder.id)
    return (
        <li
            onKeyDown={(event) => {
                if (event.key === 'Delete' && !deleting) {
                    event.preventDefault()
                    onDelete()
                }
            }}
            className={cn(
                'group relative transition-opacity duration-fast motion-reduce:transition-none',
                deleting && 'pointer-events-none opacity-0'
            )}
        >
            <Link
                href={`/media/folders/${folder.id}`}
                className="flex flex-col overflow-hidden rounded-surface border border-border bg-card outline-none transition-colors duration-fast ease-out hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
                <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-muted">
                    {folder.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL
                        <img src={folder.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                        <FolderIcon aria-hidden className="size-6 text-muted-foreground" />
                    )}
                </div>
                <div className="flex flex-col gap-1 p-4">
                    <span className="truncate text-label text-foreground">{folder.name}</span>
                    <span className="text-meta">
                        <span className="text-mono">{folder.itemCount}</span> item{folder.itemCount === 1 ? '' : 's'} · updated{' '}
                        {formatDistanceToNowStrict(new Date(folder.updatedAt), { addSuffix: true })}
                    </span>
                </div>
            </Link>
            <span className={cardMenuSlot}>
                <CardMenu label={folder.name} disabled={deleting} onDelete={onDelete} />
            </span>
        </li>
    )
}

export function FolderList() {
    const [query, setQuery] = useState('')
    const q = useDebouncedValue(query.trim())
    const foldersQuery = trpc.folders.list.useInfiniteQuery({ ...(q ? { q } : {}) }, infiniteOptions({ staleTime: 0 }))
    const list = useInfiniteList(foldersQuery)
    const deleteFolder = useDeleteFolder()

    return (
        <div className="flex flex-col gap-4">
            <div className="relative sm:max-w-sm">
                <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    size="sm"
                    type="search"
                    aria-label="Search folders"
                    placeholder="Search folders"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="ps-9"
                />
            </div>
            <InfiniteList
                list={list}
                getKey={(folder) => folder.id}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                skeletonCount={4}
                skeleton={<Skeleton className="aspect-video w-full rounded-surface" />}
                empty={
                    q ? (
                        <EmptyState icon={SearchIcon} title="No matches" description="No folder name matches that search." />
                    ) : (
                        <EmptyState
                            icon={FolderIcon}
                            title="No folders yet"
                            description="Group a video's cuts, trailers, thumbnails and subtitles in one place."
                            actions={<NewFolderPrimaryButton />}
                        />
                    )
                }
                renderItem={(folder) => (
                    <FolderCard
                        folder={folder}
                        onDelete={() => deleteFolder.request({ id: folder.id, name: folder.name, itemCount: folder.itemCount })}
                    />
                )}
            />
            {deleteFolder.dialog}
        </div>
    )
}
