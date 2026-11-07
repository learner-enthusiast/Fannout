'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { ListIcon, PenSquareIcon } from 'lucide-react'
import Link from 'next/link'

import { providers } from '~/components/connections/providers'
import { Button } from '~/components/ui/button'
import { EmptyState } from '~/components/ui/empty-state'
import { Skeleton } from '~/components/ui/skeleton'
import { StatusBadge } from '~/components/ui/status-badge'
import { trpc } from '~/trpc/client'
import { InfiniteList } from '~/components/infinite-list'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'
import { useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

export function ComposeButton() {
    return (
        <Button variant="primary" nativeButton={false} leftIcon={<PenSquareIcon aria-hidden />} render={<Link href="/compose" />}>
            New Post
        </Button>
    )
}

/** Batches newest first (cursor pagination, loads more on scroll). */
export function BatchList() {
    const [filter, setFilter] = useState<'all' | 'scheduled'>('all')
    const batchesQuery = trpc.posts.batches.useInfiniteQuery(
        { filter },
        infiniteOptions({
            staleTime: 0,
            // Publishing in progress → 5 s; only waiting on scheduled times → 30 s.
            refetchInterval: (q: { state: { data?: { pages: { items: { finished: boolean; posts: { status: string }[] }[] }[] } } }) => {
                const items = q.state.data?.pages.flatMap((p) => p.items) ?? []
                if (items.some((b) => b.posts.some((p) => ['queued', 'publishing', 'deleting'].includes(p.status)))) return 5000
                return items.some((b) => !b.finished) ? 30_000 : false
            },
        })
    )
    const list = useInfiniteList(batchesQuery)

    return (
        <>
            <ToggleGroup
                aria-label="Filter posts"
                value={[filter]}
                onValueChange={(value: string[]) => value[0] && setFilter(value[0] as 'all' | 'scheduled')}
            >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="scheduled">Scheduled</ToggleGroupItem>
            </ToggleGroup>
            <InfiniteList
                list={list}
                getKey={(batch) => batch.batchId}
                className="flex flex-col gap-2"
                skeleton={<Skeleton className="h-16 w-full rounded-surface" />}
                empty={<EmptyState icon={ListIcon} title="No posts yet" description="Compose a post and send it to your accounts." actions={<ComposeButton />} />}
                renderItem={(batch) => (
                    <li>
                        <Link
                            href={`/posts/batch/${batch.batchId}`}
                            className="flex flex-wrap items-center gap-4 rounded-surface border border-border bg-card p-4 outline-none transition-colors duration-fast ease-out hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="truncate text-label text-foreground">{batch.name}</span>
                                <span className="text-meta">
                                    {batch.posts.map((p) => providers.find((pr) => pr.slug === p.platform)?.name).join(', ')} ·{' '}
                                    {formatDistanceToNowStrict(new Date(batch.createdAt), { addSuffix: true })}
                                </span>
                            </div>
                            <span className="text-mono text-muted-foreground">
                                {batch.counts.published}/{batch.counts.total}
                            </span>
                            {batch.posts.some((p) => p.status === 'scheduled' && p.schedule?.status === 'scheduled') &&
                            !batch.posts.some((p) => ['queued', 'publishing'].includes(p.status)) ? (
                                <StatusBadge status="pending" label={`${batch.posts.filter((p) => p.status === 'scheduled').length} scheduled`} />
                            ) : !batch.finished ? (
                                <StatusBadge status="processing" label="Publishing" />
                            ) : batch.counts.failed ? (
                                <StatusBadge status="failed" label={`${batch.counts.failed} failed`} />
                            ) : (
                                <StatusBadge status="published" />
                            )}
                        </Link>
                    </li>
                )}
            />
        </>
    )
}
