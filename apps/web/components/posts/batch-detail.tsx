'use client'

import { format } from 'date-fns'
import { ExternalLinkIcon, RotateCcwIcon } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { providers } from '~/components/connections/providers'
import { PageHeader } from '~/components/layout/page-header'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { normalizeTRPCError } from '~/lib/error'
import { trpc } from '~/trpc/client'

import { PostStatusBadge } from './batch-status'
import { PostActions, PostActionState } from './post-actions'
import { onlyWaitingOnSchedule, ScheduleActions, ScheduleSummary } from './schedule-actions'

/** One row per account; polls every 3 s until every post has finished. */
export function BatchDetail({ batchId }: { batchId: string }) {
    const utils = trpc.useUtils()
    const capabilities = trpc.platforms.capabilities.useQuery(undefined, { staleTime: 60 * 60 * 1000 })
    const query = trpc.posts.batch.useQuery(
        { batchId },
        {
            staleTime: 0,
            // Keep polling while anything is publishing, deleting or editing.
            refetchInterval: (q) =>
                q.state.data && q.state.data.finished && !q.state.data.posts.some((p) => p.status === 'deleting' || p.editStatus === 'editing')
                    ? false
                    : q.state.data && onlyWaitingOnSchedule(q.state.data.posts)
                      ? 30_000
                      : 3000,
        }
    )
    const refresh = () => void utils.posts.batch.invalidate({ batchId })
    const retry = trpc.posts.retry.useMutation({
        onSuccess: () => {
            toast.success('Retrying')
            void utils.posts.batch.invalidate({ batchId })
        },
    })

    if (query.isPending) return <Skeleton className="h-64 w-full rounded-surface" aria-busy />
    if (query.isError) {
        return (
            <Alert variant="destructive">
                <AlertTitle>Could not load this batch</AlertTitle>
                <AlertDescription>{normalizeTRPCError(query.error).message}</AlertDescription>
            </Alert>
        )
    }

    const batch = query.data
    return (
        <>
            <PageHeader
                title={batch.name}
                description={`${format(new Date(batch.createdAt), 'PPp')} · ${batch.mediaType === 'video' ? 'Video' : 'Photos'} · ${batch.counts.published} of ${batch.counts.total} published${batch.finished ? '' : ' · updating…'}`}
                actions={
                    <Button variant="secondary" nativeButton={false} render={<Link href="/posts" />}>
                        All Posts
                    </Button>
                }
            />
            <Card>
                <CardContent>
                    <ul className="flex flex-col divide-y divide-border" aria-live="polite">
                        {batch.posts.map((post) => {
                            const provider = providers.find((p) => p.slug === post.platform)
                            const name = post.account.displayName ?? (post.account.username ? `@${post.account.username}` : provider?.name)
                            return (
                                <li key={post.id} className="flex flex-wrap items-center gap-4 py-4">
                                    <Avatar>
                                        {post.account.profilePictureUrl ? <AvatarImage src={post.account.profilePictureUrl} alt="" /> : null}
                                        <AvatarFallback>{(name ?? '?').slice(0, 1).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                                        <Link href={`/posts/post/${post.id}`} className="truncate text-label text-foreground hover:underline">
                                            {name} <span className="text-meta">· {provider?.name}</span>
                                        </Link>
                                        <span className="text-meta">
                                            {post.deleteErrorMessage ??
                                                post.editErrorMessage ??
                                                (post.status === 'failed' ? (post.errorMessage ?? 'Failed') : (post.step ?? 'Waiting'))}
                                        </span>
                                        <ScheduleSummary post={post} />
                                    </div>
                                    <PostStatusBadge status={post.status} />
                                    <PostActionState post={post} />
                                    {post.postUrl ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            nativeButton={false}
                                            leftIcon={<ExternalLinkIcon aria-hidden />}
                                            render={<a href={post.postUrl} target="_blank" rel="noreferrer" />}
                                        >
                                            View Post
                                        </Button>
                                    ) : null}
                                    <ScheduleActions post={post} accountName={name ?? 'this account'} onChanged={refresh} />
                                    <PostActions
                                        post={post}
                                        capabilities={capabilities.data?.find((c) => c.platform === post.platform)}
                                        accountName={name ?? 'this account'}
                                        onChanged={refresh}
                                    />
                                    {post.status === 'failed' && post.schedule?.status !== 'missed' ? (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            leftIcon={<RotateCcwIcon aria-hidden />}
                                            loading={retry.isPending && retry.variables?.postId === post.id}
                                            onClick={() => retry.mutate({ postId: post.id })}
                                        >
                                            Retry
                                        </Button>
                                    ) : null}
                                </li>
                            )
                        })}
                    </ul>
                </CardContent>
            </Card>
        </>
    )
}
