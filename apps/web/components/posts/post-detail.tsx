'use client'

import { format } from 'date-fns'
import { ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'

import { providers } from '~/components/connections/providers'
import { PageHeader } from '~/components/layout/page-header'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { normalizeTRPCError } from '~/lib/error'
import { trpc } from '~/trpc/client'

import { PostStatusBadge } from './batch-status'
import { PostActions, PostActionState } from './post-actions'

const show = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : Array.isArray(value) ? value.join(', ') : String(value))

export function PostDetail({ postId }: { postId: string }) {
    const utils = trpc.useUtils()
    const capabilities = trpc.platforms.capabilities.useQuery({}, { staleTime: 60 * 60 * 1000 })
    const query = trpc.posts.get.useQuery(
        { postId },
        { staleTime: 0, refetchInterval: (q) => (q.state.data && (q.state.data.status === 'deleting' || q.state.data.editStatus === 'editing') ? 3000 : false) }
    )
    if (query.isPending) return <Skeleton className="h-64 w-full rounded-surface" aria-busy />
    if (query.isError) {
        return (
            <Alert variant="destructive">
                <AlertTitle>Could not load this post</AlertTitle>
                <AlertDescription>{normalizeTRPCError(query.error).message}</AlertDescription>
            </Alert>
        )
    }
    const post = query.data
    const provider = providers.find((p) => p.slug === post.platform)
    const account = post.account.displayName ?? (post.account.username ? `@${post.account.username}` : provider?.name ?? 'account')
    const caps = capabilities.data?.find((c) => c.platform === post.platform)

    return (
        <>
            <PageHeader
                title={post.name}
                description={`${provider?.name ?? post.platform} · ${account}${post.publishedAt ? ` · published ${format(new Date(post.publishedAt), 'PPp')}` : ''}`}
                actions={
                    post.batchId ? (
                        <Button variant="secondary" nativeButton={false} render={<Link href={`/posts/batch/${post.batchId}`} />}>
                            Back to Batch
                        </Button>
                    ) : null
                }
            />
            <div className="flex flex-wrap items-center gap-2">
                <PostStatusBadge status={post.status as never} />
                <PostActionState post={post} />
                <div className="ms-auto flex flex-wrap items-center gap-2">
                    {post.postUrl && post.status === 'published' ? (
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
                    <PostActions post={post} capabilities={caps} accountName={account} onChanged={() => void utils.posts.get.invalidate({ postId })} />
                </div>
            </div>
            {post.deleteErrorMessage || post.editErrorMessage ? (
                <Alert variant="destructive">
                    <AlertDescription>{post.deleteErrorMessage ?? post.editErrorMessage}</AlertDescription>
                </Alert>
            ) : null}
            <Tabs defaultValue="details">
                <TabsList>
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="history">{`History (${post.revisions.length})`}</TabsTrigger>
                </TabsList>
                <TabsContent value="details" className="pt-4">
                    <Card>
                        <CardContent>
                            <dl className="flex flex-col gap-4">
                                {Object.entries(post.input).map(([field, value]) => (
                                    <div key={field} className="flex flex-col gap-1">
                                        <dt className="text-meta">{caps?.fields.find((f) => f.name === field)?.label ?? field}</dt>
                                        <dd className="whitespace-pre-wrap break-words text-foreground">{show(value)}</dd>
                                    </div>
                                ))}
                            </dl>
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="history" className="pt-4">
                    {post.revisions.length === 0 ? (
                        <p className="text-meta">No edits yet.</p>
                    ) : (
                        <ol className="flex flex-col gap-4">
                            {[...post.revisions].reverse().map((revision) => (
                                <li key={revision.at}>
                                    <Card>
                                        <CardContent className="flex flex-col gap-2">
                                            <span className="text-meta">{format(new Date(revision.at), 'PPp')}</span>
                                            {Object.keys(revision.after).map((field) => (
                                                <div key={field} className="grid gap-1 sm:grid-cols-2">
                                                    <span className="text-meta">
                                                        {caps?.fields.find((f) => f.name === field)?.label ?? field} — before: {show(revision.before[field])}
                                                    </span>
                                                    <span className="text-foreground">after: {show(revision.after[field])}</span>
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                </li>
                            ))}
                        </ol>
                    )}
                </TabsContent>
            </Tabs>
        </>
    )
}
