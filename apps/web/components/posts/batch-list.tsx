'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { ListIcon, PenSquareIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { providers } from '~/components/connections/providers'
import { Button } from '~/components/ui/button'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import { EmptyState } from '~/components/ui/empty-state'
import { Skeleton } from '~/components/ui/skeleton'
import { StatusBadge } from '~/components/ui/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { BatchPublishingBadge } from './batch-status'
import { trpc } from '~/trpc/client'
import { InfiniteList } from '~/components/infinite-list'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'
import { normalizeTRPCError } from '~/lib/error'
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
    const [filter, setFilter] = useState<'all' | 'scheduled' | 'manual'>('all')
    const [cancelAllOpen, setCancelAllOpen] = useState(false)
    const utils = trpc.useUtils()
    const remove = trpc.posts.delete.useMutation()
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

    const failedPostIds = useMemo(() => {
        const ids: string[] = []
        const seen = new Set<string>()
        for (const batch of list.items) {
            for (const post of batch.posts) {
                if (post.status === 'failed' && !seen.has(post.id)) {
                    seen.add(post.id)
                    ids.push(post.id)
                }
            }
        }
        return ids
    }, [list.items])

    const cancelAllFailed = async () => {
        let cancelled = 0
        let errors = 0
        let lastError: unknown
        for (const postId of failedPostIds) {
            try {
                const result = await remove.mutateAsync({ postId })
                if (result.mode !== 'noop') cancelled += 1
            } catch (error) {
                errors += 1
                lastError = error
            }
        }
        void utils.posts.batches.invalidate()
        if (errors === failedPostIds.length) {
            toast.error(normalizeTRPCError(lastError).message)
        } else if (errors > 0) {
            toast.warning(`Cancelled ${cancelled} of ${failedPostIds.length} failed posts`)
        } else if (cancelled > 0) {
            toast.success(cancelled === 1 ? 'Cancelled 1 failed post' : `Cancelled ${cancelled} failed posts`)
        }
    }

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <ToggleGroup
                    aria-label="Filter posts"
                    value={[filter]}
                    onValueChange={(value: string[]) => value[0] && setFilter(value[0] as 'all' | 'scheduled' | 'manual')}
                >
                    <ToggleGroupItem value="all">All</ToggleGroupItem>
                    <ToggleGroupItem value="scheduled">Scheduled</ToggleGroupItem>
                    <ToggleGroupItem value="manual">Manual pending</ToggleGroupItem>
                </ToggleGroup>
                {failedPostIds.length > 0 ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    leftIcon={<XIcon aria-hidden />}
                                    loading={remove.isPending}
                                    onClick={() => setCancelAllOpen(true)}
                                >
                                    Cancel all ({failedPostIds.length})
                                </Button>
                            }
                        />
                        <TooltipContent>
                            Cancel all posts in this list that did not publish because of an error. Nothing is removed from the platforms.
                        </TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            <ConfirmDialog
                open={cancelAllOpen}
                onOpenChange={setCancelAllOpen}
                title={failedPostIds.length === 1 ? 'Cancel 1 failed post?' : `Cancel ${failedPostIds.length} failed posts?`}
                description="These posts never went live. Cancelling clears them from your list; nothing is deleted on the platforms."
                confirmLabel={failedPostIds.length === 1 ? 'Cancel post' : `Cancel ${failedPostIds.length}`}
                cancelLabel="Keep"
                onConfirm={cancelAllFailed}
            />
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
                            ) : batch.posts.some((p) => p.manual?.status === 'pending') && batch.finished ? (
                                <StatusBadge status="pending" label={`${batch.posts.filter((p) => p.manual?.status === 'pending').length} manual pending`} />
                            ) : !batch.finished ? (
                                <BatchPublishingBadge postIds={batch.posts.map((p) => p.id)} />
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
