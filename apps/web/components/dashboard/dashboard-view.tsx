'use client'

import {
    ArrowDownRightIcon,
    ArrowUpRightIcon,
    BarChart3Icon,
    CalendarClockIcon,
    ExternalLinkIcon,
    LinkIcon,
    MinusIcon,
    RefreshCwIcon,
    TriangleAlertIcon,
    UnplugIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { RouterOutputs } from '@repo/trpc/client'
import { InfiniteList } from '~/components/infinite-list'
import { PageHeader } from '~/components/layout/page-header'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { EmptyState } from '~/components/ui/empty-state'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'
import {
    formatCompact,
    formatDate,
    formatExact,
    formatMetric,
    formatPercent,
    formatRelative,
    LOWER_IS_BETTER,
    metricLabel,
    NONE,
    platformMeta,
    type AnalyticsPlatform,
} from '~/lib/analytics-format'
import { normalizeTRPCError } from '~/lib/error'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'

import { BestTimesHeatmap, EngagementByPlatform, ViewsOverTime, ViewsShare } from './dashboard-charts'

type Overview = RouterOutputs['analytics']['overview']
type Kpi = Overview['kpis']['views']
type SyncConnection = RouterOutputs['analytics']['syncStatus']['connections'][number]
type TopPost = RouterOutputs['analytics']['topPosts']['items'][number]
type RangeKey = '7d' | '28d' | '90d' | 'custom'

const RANGES: { value: RangeKey; label: string }[] = [
    { value: '7d', label: '7 days' },
    { value: '28d', label: '28 days' },
    { value: '90d', label: '90 days' },
    { value: 'custom', label: 'Custom' },
]

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** Tab + range live in the URL (?tab=all|<connectionId>&range=28d[&from&to]). */
function useDashboardParams() {
    const params = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()
    const range = (RANGES.some((r) => r.value === params.get('range')) ? params.get('range') : '28d') as RangeKey
    const set = (patch: Record<string, string | null>) => {
        const next = new URLSearchParams(params.toString())
        for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k)
            else next.set(k, v)
        }
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    }
    return {
        tab: params.get('tab') ?? 'all',
        range,
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
        set,
    }
}

export function DashboardView() {
    const { tab, range, from, to, set } = useDashboardParams()
    const tz = useMemo(timeZone, [])
    const status = trpc.analytics.syncStatus.useQuery({}, { staleTime: 30_000 })
    const connections = status.data?.connections ?? []
    const active = tab === 'all' ? null : (connections.find((c) => c.connectionId === tab) ?? null)
    const connectionId = active?.connectionId

    // A custom range waits for both dates.
    const customReady = range !== 'custom' || Boolean(from && to && from <= to)
    const rangeInput = range === 'custom' ? { range, from, to } : { range }

    return (
        <div className="flex flex-col gap-8">
            <PageHeader title="Dashboard" description="How your accounts and posts are doing." />

            {status.isLoading ? (
                <Skeleton className="h-10 w-full" />
            ) : (
                <Tabs value={active ? tab : 'all'} onValueChange={(value) => set({ tab: value === 'all' ? null : String(value) })}>
                    <div className="overflow-x-auto">
                        <TabsList variant="line" aria-label="Accounts">
                            <TabsTrigger value="all">All</TabsTrigger>
                            {connections.map((c) => {
                                const meta = platformMeta(c.platform)
                                const Icon = meta.icon
                                return (
                                    <TabsTrigger key={c.connectionId} value={c.connectionId}>
                                        {Icon ? <Icon aria-hidden /> : null}
                                        <span>{c.username ? `@${c.username}` : meta.label}</span>
                                        <span className="sr-only">({meta.label})</span>
                                    </TabsTrigger>
                                )
                            })}
                        </TabsList>
                    </div>
                </Tabs>
            )}

            <Toolbar
                range={range}
                from={from}
                to={to}
                onRange={(value) => set(value === 'custom' ? { range: value } : { range: value, from: null, to: null })}
                onDates={(patch) => set(patch)}
                connections={active ? [active] : connections}
            />

            {customReady ? (
                active && active.status !== 'ready' && active.status !== 'error' ? (
                    <ConnectionEmpty connection={active} />
                ) : (
                    <DashboardBody rangeInput={rangeInput} connectionId={connectionId} platform={active?.platform ?? null} timeZone={tz} connections={connections} />
                )
            ) : (
                <p className="text-meta">Pick a start and end date for the custom range.</p>
            )}
        </div>
    )
}

function Toolbar({
    range,
    from,
    to,
    onRange,
    onDates,
    connections,
}: {
    range: RangeKey
    from?: string
    to?: string
    onRange: (value: RangeKey) => void
    onDates: (patch: { from?: string; to?: string }) => void
    connections: SyncConnection[]
}) {
    const utils = trpc.useUtils()
    const refresh = trpc.analytics.refresh.useMutation({ onError: () => undefined })
    const [busy, setBusy] = useState(false)
    const refreshable = connections.filter((c) => c.status !== 'unsupported' && c.status !== 'needs_reconnect')
    const lastSynced = connections
        .map((c) => c.lastSyncedAt)
        .filter((v): v is string => Boolean(v))
        .sort()
        .at(-1)
    const waiting = refreshable.length > 0 && refreshable.every((c) => c.refreshAvailableAt)

    const onRefresh = async () => {
        setBusy(true)
        let queued = 0
        let limited = 0
        for (const c of refreshable) {
            try {
                await refresh.mutateAsync({ connectionId: c.connectionId })
                queued += 1
            } catch (error) {
                if (normalizeTRPCError(error).code === 'TOO_MANY_REQUESTS') limited += 1
                else toast.error(normalizeTRPCError(error).message)
            }
        }
        setBusy(false)
        await utils.analytics.syncStatus.invalidate()
        if (queued) toast.success(`Refreshing ${queued} account${queued === 1 ? '' : 's'}. New numbers appear in a few minutes.`)
        else if (limited) toast.error('Already refreshed in the last 15 minutes. Try again later.')
    }

    return (
        <div className="flex flex-wrap items-center gap-4">
            <ToggleGroup
                aria-label="Date range"
                size="sm"
                value={[range]}
                onValueChange={(value) => {
                    const next = value[0] as RangeKey | undefined
                    if (next) onRange(next)
                }}
            >
                {RANGES.map((r) => (
                    <ToggleGroupItem key={r.value} value={r.value} aria-label={r.label}>
                        {r.label}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            {range === 'custom' ? (
                <div className="flex items-center gap-2">
                    <Input type="date" size="sm" aria-label="From" value={from ?? ''} max={to} onChange={(e) => onDates({ from: e.target.value })} />
                    <span className="text-meta">to</span>
                    <Input type="date" size="sm" aria-label="To" value={to ?? ''} min={from} onChange={(e) => onDates({ to: e.target.value })} />
                </div>
            ) : null}
            <div className="ms-auto flex items-center gap-4">
                <span className="text-meta" aria-live="polite">
                    {lastSynced ? `Synced ${formatRelative(lastSynced)}` : 'Not synced yet'}
                </span>
                <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<RefreshCwIcon aria-hidden />}
                    loading={busy}
                    disabled={refreshable.length === 0 || waiting}
                    onClick={() => void onRefresh()}
                >
                    Refresh
                </Button>
            </div>
        </div>
    )
}

function ConnectionEmpty({ connection }: { connection: SyncConnection }) {
    if (connection.status === 'unsupported') {
        return <EmptyState icon={UnplugIcon} title="No analytics for this account" description="Analytics aren't available with the current LinkedIn access." />
    }
    if (connection.status === 'needs_reconnect') {
        return (
            <EmptyState
                icon={LinkIcon}
                title="Permission needed"
                description={
                    connection.missingScopes.length
                        ? `Reconnect this account to grant analytics access (${connection.missingScopes.length} permission${connection.missingScopes.length === 1 ? '' : 's'} missing).`
                        : 'Reconnect this account to grant analytics access.'
                }
                actions={
                    <Button variant="primary" render={<Link href="/connections" />}>
                        Reconnect to Enable Analytics
                    </Button>
                }
            />
        )
    }
    return <EmptyState icon={BarChart3Icon} title="No analytics yet" description="Analytics appear after your first sync." />
}

function DashboardBody({
    rangeInput,
    connectionId,
    platform,
    timeZone,
    connections,
}: {
    rangeInput: { range: RangeKey; from?: string; to?: string }
    connectionId?: string
    platform: AnalyticsPlatform | null
    timeZone: string
    connections: SyncConnection[]
}) {
    const input = { ...rangeInput, timeZone, ...(connectionId ? { connectionId } : {}) }
    const overview = trpc.analytics.overview.useQuery(input, { staleTime: 60_000, placeholderData: (prev) => prev })
    const bestTimes = trpc.analytics.bestTimes.useQuery(input, { staleTime: 5 * 60_000, placeholderData: (prev) => prev })
    const data = overview.data
    const loading = overview.isLoading
    const anyData = connectionId ? true : connections.some((c) => c.status === 'ready' || c.status === 'error')

    if (overview.isError) {
        return (
            <EmptyState
                icon={TriangleAlertIcon}
                title="Couldn't load analytics"
                description={normalizeTRPCError(overview.error).message}
                actions={
                    <Button variant="secondary" leftIcon={<RefreshCwIcon aria-hidden />} onClick={() => void overview.refetch()}>
                        Try Again
                    </Button>
                }
            />
        )
    }

    const k = data?.kpis
    const rateLabel = k?.engagementRateBasis ? `Engagement rate (per ${k.engagementRateBasis.replace(/s$/, '')})` : 'Engagement rate'
    return (
        <div className={cn('flex flex-col gap-8 transition-opacity duration-fast', overview.isPlaceholderData && 'opacity-60')}>
            <section aria-labelledby="kpis" className="flex flex-col gap-4">
                <h2 id="kpis" className="sr-only">
                    Key numbers
                </h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                    <KpiTile label="Views" kpi={k?.views} loading={loading} />
                    <KpiTile label="Engagement" kpi={k?.engagement} loading={loading} />
                    <KpiTile label={rateLabel} kpi={k?.engagementRate} loading={loading} format={formatPercent} />
                    <KpiTile label={platform === 'youtube' ? 'Subscribers (net)' : 'Followers (net)'} kpi={k?.followersNet} loading={loading} signed />
                    <KpiTile label="Posts published" kpi={k?.postsPublished} loading={loading} note="With Fannout" />
                    <KpiTile label="Publish success rate" kpi={k?.publishSuccessRate} loading={loading} format={formatPercent} note="With Fannout" />
                </div>
                {platform && k && Object.keys(k.platform).length ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        {Object.entries(k.platform).map(([key, kpi]) => (
                            <KpiTile
                                key={key}
                                label={metricLabel(key, platform)}
                                kpi={kpi}
                                format={(v) => formatMetric(key, v)}
                                lowerIsBetter={LOWER_IS_BETTER.has(key)}
                                note={platform === 'x' ? 'From posts published with Fannout' : undefined}
                            />
                        ))}
                    </div>
                ) : null}
                {platform === 'x' ? <p className="text-meta">X numbers update at 1 h, 24 h, 7 d and 30 d after posting to limit API cost.</p> : null}
                {(data?.availability ?? []).some((a) => a.note && (!connectionId || a.connectionId === connectionId) && a.platform !== 'x') ? (
                    <ul className="flex flex-col gap-1">
                        {[...new Set((data?.availability ?? []).filter((a) => a.note && a.platform !== 'x' && (!connectionId || a.connectionId === connectionId)).map((a) => `${platformMeta(a.platform).label}: ${a.note}`))].map((note) => (
                            <li key={note} className="text-meta">
                                {note}
                            </li>
                        ))}
                    </ul>
                ) : null}
            </section>

            {anyData ? (
                <>
                    <ViewsOverTime series={data?.series ?? []} from={data?.range.from ?? ''} to={data?.range.to ?? ''} loading={loading} />
                    <div className="grid gap-8 lg:grid-cols-2">
                        <EngagementByPlatform byPlatform={data?.byPlatform ?? []} loading={loading} />
                        <ViewsShare byPlatform={data?.byPlatform ?? []} loading={loading} />
                    </div>
                    <BestTimesHeatmap cells={bestTimes.data?.cells ?? []} timeZone={timeZone} loading={bestTimes.isLoading} />
                    <TopPosts rangeInput={rangeInput} connectionId={connectionId} />
                </>
            ) : (
                <EmptyState icon={BarChart3Icon} title="No analytics yet" description="Analytics appear after your first sync." />
            )}

            <div className="grid gap-8 lg:grid-cols-2">
                <Upcoming items={data?.upcoming ?? []} loading={loading} />
                <Failures items={data?.recentFailures ?? []} loading={loading} />
            </div>
        </div>
    )
}

function KpiTile({
    label,
    kpi,
    loading,
    format = formatCompact,
    signed,
    lowerIsBetter,
    note,
}: {
    label: string
    kpi: Kpi | undefined
    loading?: boolean
    format?: (value: number | null | undefined) => string
    signed?: boolean
    lowerIsBetter?: boolean
    note?: string
}) {
    const value = kpi?.current ?? null
    const shown = value === null ? NONE : `${signed && value > 0 ? '+' : ''}${format(value)}`
    return (
        <Card>
            <CardHeader>
                <CardDescription>{label}</CardDescription>
                {loading ? (
                    <Skeleton className="h-8 w-24" />
                ) : (
                    <CardTitle>
                        <span className="text-page-title font-mono tabular-nums" title={value === null ? 'Not reported' : formatExact(value)}>
                            {shown}
                        </span>
                    </CardTitle>
                )}
            </CardHeader>
            <CardContent>{loading ? <Skeleton className="h-4 w-20" /> : <Delta kpi={kpi} lowerIsBetter={lowerIsBetter} note={note} />}</CardContent>
        </Card>
    )
}

/** Arrow icon + signed text + colour (never colour alone). */
function Delta({ kpi, lowerIsBetter, note }: { kpi: Kpi | undefined; lowerIsBetter?: boolean; note?: string }) {
    const d = kpi?.deltaPercent
    if (d === null || d === undefined || !Number.isFinite(d)) {
        return <span className="text-meta">{note ?? 'No previous data'}</span>
    }
    const up = d > 0
    const flat = Math.abs(d) < 0.05
    const good = flat ? null : up !== Boolean(lowerIsBetter)
    const Icon = flat ? MinusIcon : up ? ArrowUpRightIcon : ArrowDownRightIcon
    return (
        <span className={cn('flex items-center gap-1 text-meta', good === true && 'text-success', good === false && 'text-destructive')}>
            <Icon aria-hidden className="size-4" />
            <span className="font-mono tabular-nums">
                {up ? '+' : ''}
                {d.toFixed(Math.abs(d) >= 10 ? 0 : 1)}%
            </span>
            <span>vs previous period</span>
        </span>
    )
}

function TopPosts({ rangeInput, connectionId }: { rangeInput: { range: RangeKey; from?: string; to?: string }; connectionId?: string }) {
    const [sortBy, setSortBy] = useState<'views' | 'engagement' | 'likes'>('views')
    const query = trpc.analytics.topPosts.useInfiniteQuery({ ...rangeInput, sortBy, ...(connectionId ? { connectionId } : {}) }, infiniteOptions({ staleTime: 60_000 }))
    const list = useInfiniteList<TopPost>(query)
    return (
        <Card>
            <CardHeader>
                <CardTitle>Top posts</CardTitle>
                <CardDescription>Posts published with Fannout in this range, with their latest synced numbers.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <ToggleGroup aria-label="Sort top posts by" size="sm" value={[sortBy]} onValueChange={(v) => v[0] && setSortBy(v[0] as typeof sortBy)}>
                    <ToggleGroupItem value="views">Views</ToggleGroupItem>
                    <ToggleGroupItem value="engagement">Engagement</ToggleGroupItem>
                    <ToggleGroupItem value="likes">Likes</ToggleGroupItem>
                </ToggleGroup>
                <div className="overflow-x-auto">
                    <InfiniteList
                        list={list}
                        getKey={(p) => p.postId}
                        container={(rows) => (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Post</TableHead>
                                        <TableHead>Published</TableHead>
                                        <TableHead className="text-end">Views</TableHead>
                                        <TableHead className="text-end">Engagement</TableHead>
                                        <TableHead>
                                            <span className="sr-only">Link</span>
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>{rows}</TableBody>
                            </Table>
                        )}
                        skeleton={
                            <TableRow>
                                <TableCell colSpan={5}>
                                    <Skeleton className="h-10 w-full" />
                                </TableCell>
                            </TableRow>
                        }
                        empty={<p className="text-meta">No synced posts in this range yet.</p>}
                        endLabel="That's every post in this range"
                        renderItem={(p) => <TopPostRow post={p} />}
                    />
                </div>
            </CardContent>
        </Card>
    )
}

function TopPostRow({ post }: { post: TopPost }) {
    const meta = platformMeta(post.platform)
    const Icon = meta.icon
    // X reports impressions, not views.
    const views = post.metrics.views ?? post.metrics.impressions ?? null
    return (
        <TableRow>
            <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                    {post.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL, not optimizable
                        <img src={post.thumbnailUrl} alt="" className="size-10 shrink-0 rounded-control border border-border object-cover" />
                    ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-border">
                            {Icon ? <Icon aria-hidden className="size-4" /> : null}
                        </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                        <span className="truncate text-label text-foreground">{post.title}</span>
                        <span className="flex items-center gap-1 text-meta">
                            {Icon ? <Icon aria-hidden className="size-4" /> : null}
                            {meta.label}
                        </span>
                    </span>
                </div>
            </TableCell>
            <TableCell className="text-meta">{formatDate(post.publishedAt)}</TableCell>
            <TableCell className="text-end text-mono" title={views === null ? 'Not reported' : undefined}>
                {formatExact(views)}
            </TableCell>
            <TableCell className="text-end text-mono">{formatExact(post.engagement)}</TableCell>
            <TableCell>
                {post.postUrl ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Open "${post.title}" on ${meta.label}`} render={<a href={post.postUrl} target="_blank" rel="noreferrer" />}>
                        <ExternalLinkIcon aria-hidden />
                    </Button>
                ) : null}
            </TableCell>
        </TableRow>
    )
}

function Upcoming({ items, loading }: { items: Overview['upcoming']; loading?: boolean }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Upcoming</CardTitle>
                <CardDescription>Next scheduled posts.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-24 w-full" />
                ) : items.length ? (
                    <ul className="flex flex-col gap-2">
                        {items.map((p) => {
                            const meta = platformMeta(p.platform)
                            const Icon = meta.icon
                            return (
                                <li key={p.postId} className="flex items-center gap-2">
                                    {Icon ? <Icon aria-label={meta.label} className="size-4 shrink-0" /> : null}
                                    <span className="min-w-0 flex-1 truncate text-body">{p.name}</span>
                                    <span className="flex items-center gap-1 text-meta">
                                        <CalendarClockIcon aria-hidden className="size-4" />
                                        {new Date(p.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                    </span>
                                </li>
                            )
                        })}
                    </ul>
                ) : (
                    <p className="text-meta">Nothing scheduled.</p>
                )}
            </CardContent>
        </Card>
    )
}

function Failures({ items, loading }: { items: Overview['recentFailures']; loading?: boolean }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Recent failures</CardTitle>
                <CardDescription>Posts that didn&apos;t publish.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-24 w-full" />
                ) : items.length ? (
                    <ul className="flex flex-col gap-2">
                        {items.map((p) => {
                            const meta = platformMeta(p.platform)
                            const Icon = meta.icon
                            return (
                                <li key={p.postId} className="flex flex-col gap-1">
                                    <span className="flex items-center gap-2">
                                        <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
                                        <span className="sr-only">Failed:</span>
                                        {Icon ? <Icon aria-label={meta.label} className="size-4 shrink-0" /> : null}
                                        <span className="min-w-0 flex-1 truncate text-body">{p.name}</span>
                                        <span className="text-meta">{formatRelative(p.failedAt)}</span>
                                    </span>
                                    {p.errorMessage ? <span className="truncate text-meta">{p.errorMessage}</span> : null}
                                </li>
                            )
                        })}
                    </ul>
                ) : (
                    <p className="text-meta">No failed posts.</p>
                )}
            </CardContent>
        </Card>
    )
}
