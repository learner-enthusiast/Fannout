'use client'

import { TableIcon, BarChart3Icon } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'

import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from '~/components/ui/chart'
import { Skeleton } from '~/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatCompact, formatExact, NONE, platformMeta, type AnalyticsPlatform } from '~/lib/analytics-format'
import { cn } from '~/lib/utils'

/** Chart colours come only from --chart-<platform> tokens (globals.css). */
export function platformChartConfig(platforms: AnalyticsPlatform[]): ChartConfig {
    return Object.fromEntries(platforms.map((p) => [p, { label: platformMeta(p).label, color: platformMeta(p).color }]))
}

/**
 * Card for one chart: title, sr-only text summary, and a "View as table" toggle
 * so every chart's numbers are reachable without the graphic.
 */
export function ChartCard({
    title,
    description,
    summary,
    table,
    loading,
    skeleton = 'area',
    children,
}: {
    title: string
    description?: string
    /** Read by screen readers instead of the graphic. */
    summary: string
    table: React.ReactNode
    loading?: boolean
    skeleton?: 'area' | 'bar' | 'donut' | 'grid'
    children: React.ReactNode
}) {
    const [asTable, setAsTable] = useState(false)
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                {description ? <CardDescription>{description}</CardDescription> : null}
                <CardAction>
                    <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={asTable ? <BarChart3Icon aria-hidden /> : <TableIcon aria-hidden />}
                        aria-pressed={asTable}
                        onClick={() => setAsTable((v) => !v)}
                        disabled={loading}
                    >
                        {asTable ? 'View as Chart' : 'View as Table'}
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <ChartSkeleton shape={skeleton} />
                ) : asTable ? (
                    table
                ) : (
                    <figure>
                        <figcaption className="sr-only">{summary}</figcaption>
                        <div aria-hidden>{children}</div>
                    </figure>
                )}
            </CardContent>
        </Card>
    )
}

/** Placeholders shaped like the chart they stand in for. */
export function ChartSkeleton({ shape }: { shape: 'area' | 'bar' | 'donut' | 'grid' }) {
    if (shape === 'donut') {
        return (
            <div className="flex h-64 items-center justify-center" aria-hidden>
                <Skeleton className="size-48 rounded-full" />
            </div>
        )
    }
    if (shape === 'grid') {
        return (
            <div className="grid grid-cols-12 gap-1" aria-hidden>
                {Array.from({ length: 84 }, (_, i) => (
                    <Skeleton key={i} className="h-4" />
                ))}
            </div>
        )
    }
    if (shape === 'bar') {
        return (
            <div className="flex h-64 items-end gap-4" aria-hidden>
                {[40, 64, 24, 48, 32].map((h, i) => (
                    <Skeleton key={i} className={cn('flex-1', h === 64 ? 'h-56' : h === 48 ? 'h-40' : h === 40 ? 'h-32' : h === 32 ? 'h-24' : 'h-16')} />
                ))}
            </div>
        )
    }
    return <Skeleton className="h-64 w-full" aria-hidden />
}

function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
    return (
        <div className="max-h-64 overflow-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        {head.map((h) => (
                            <TableHead key={h}>{h}</TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row, i) => (
                        <TableRow key={i}>
                            {row.map((cell, j) => (
                                <TableCell key={j} className={j > 0 ? 'text-mono' : undefined}>
                                    {cell}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}

type Point = { date: string; platform: AnalyticsPlatform; views: number | null }

/** Views per day, one area per platform. Days without data stay gaps (not 0). */
export function ViewsOverTime({ series, from, to, loading }: { series: Point[]; from: string; to: string; loading?: boolean }) {
    const platforms = [...new Set(series.filter((p) => p.views !== null).map((p) => p.platform))]
    const config = platformChartConfig(platforms)
    const days: string[] = []
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10))
    const data = days.map((date) => ({
        date,
        ...Object.fromEntries(platforms.map((p) => [p, series.find((s) => s.date === date && s.platform === p)?.views ?? null])),
    }))
    const totals = platforms.map((p) => `${platformMeta(p).label} ${formatExact(series.filter((s) => s.platform === p).reduce((a, s) => a + (s.views ?? 0), 0))}`)
    return (
        <ChartCard
            title="Views over time"
            description="Platform-reported views per day."
            loading={loading}
            summary={platforms.length ? `Views from ${from} to ${to}: ${totals.join(', ')}.` : 'No views reported in this range.'}
            table={<SimpleTable head={['Date', ...platforms.map((p) => platformMeta(p).label)]} rows={data.map((row) => [row.date, ...platforms.map((p) => formatExact((row as unknown as Record<string, number | null>)[p]))])} />}
        >
            {platforms.length ? (
                <ChartContainer config={config} className="h-64 w-full">
                    <AreaChart data={data} margin={{ left: 0, right: 8 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatCompact(v)} />
                        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        {platforms.map((p) => (
                            <Area key={p} dataKey={p} type="monotone" stroke={`var(--color-${p})`} fill={`var(--color-${p})`} fillOpacity={0.15} connectNulls={false} />
                        ))}
                    </AreaChart>
                </ChartContainer>
            ) : (
                <NoChartData />
            )}
        </ChartCard>
    )
}

type PlatformTotal = { platform: AnalyticsPlatform; views: number | null; engagement: number | null }

export function EngagementByPlatform({ byPlatform, loading }: { byPlatform: PlatformTotal[]; loading?: boolean }) {
    const data = byPlatform.filter((p) => p.engagement !== null)
    const config = platformChartConfig(data.map((d) => d.platform))
    return (
        <ChartCard
            title="Engagement by platform"
            description="Likes, comments, shares, saves, reposts and quotes."
            loading={loading}
            skeleton="bar"
            summary={data.length ? `Engagement: ${data.map((d) => `${platformMeta(d.platform).label} ${formatExact(d.engagement)}`).join(', ')}.` : 'No engagement reported in this range.'}
            table={<SimpleTable head={['Platform', 'Engagement']} rows={byPlatform.map((d) => [platformMeta(d.platform).label, formatExact(d.engagement)])} />}
        >
            {data.length ? (
                <ChartContainer config={config} className="h-64 w-full">
                    <BarChart data={data.map((d) => ({ ...d, label: platformMeta(d.platform).label }))}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatCompact(v)} />
                        <ChartTooltip content={<ChartTooltipContent hideIndicator nameKey="platform" />} />
                        <Bar dataKey="engagement" radius={8}>
                            {data.map((d) => (
                                <Cell key={d.platform} fill={`var(--color-${d.platform})`} />
                            ))}
                        </Bar>
                    </BarChart>
                </ChartContainer>
            ) : (
                <NoChartData />
            )}
        </ChartCard>
    )
}

export function ViewsShare({ byPlatform, loading }: { byPlatform: PlatformTotal[]; loading?: boolean }) {
    const data = byPlatform.filter((p) => typeof p.views === 'number' && p.views > 0)
    const total = data.reduce((a, d) => a + (d.views ?? 0), 0)
    const config = platformChartConfig(data.map((d) => d.platform))
    const share = (v: number | null) => (total && v ? `${((v / total) * 100).toFixed(1)}%` : NONE)
    return (
        <ChartCard
            title="Share of views"
            description="Views by platform in this range."
            loading={loading}
            skeleton="donut"
            summary={data.length ? `Share of views: ${data.map((d) => `${platformMeta(d.platform).label} ${share(d.views)}`).join(', ')}.` : 'No views reported in this range.'}
            table={<SimpleTable head={['Platform', 'Views', 'Share']} rows={byPlatform.map((d) => [platformMeta(d.platform).label, formatExact(d.views), share(d.views)])} />}
        >
            {data.length ? (
                <ChartContainer config={config} className="h-64 w-full">
                    <PieChart>
                        <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="platform" />} />
                        <Pie data={data} dataKey="views" nameKey="platform" innerRadius={56} strokeWidth={2}>
                            {data.map((d) => (
                                <Cell key={d.platform} fill={`var(--color-${d.platform})`} />
                            ))}
                        </Pie>
                        <ChartLegend content={<ChartLegendContent nameKey="platform" />} />
                    </PieChart>
                </ChartContainer>
            ) : (
                <NoChartData />
            )}
        </ChartCard>
    )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Opacity steps on the primary token (no arbitrary colours). */
const HEAT = ['bg-muted', 'bg-primary/20', 'bg-primary/40', 'bg-primary/60', 'bg-primary/80', 'bg-primary']

export function BestTimesHeatmap({
    cells,
    timeZone,
    loading,
}: {
    cells: { weekday: number; hour: number; posts: number; avgEngagement: number }[]
    timeZone: string
    loading?: boolean
}) {
    const max = Math.max(0, ...cells.map((c) => c.avgEngagement))
    const at = (weekday: number, hour: number) => cells.find((c) => c.weekday === weekday && c.hour === hour)
    const best = [...cells].sort((a, b) => b.avgEngagement - a.avgEngagement).slice(0, 3)
    const label = (c: { weekday: number; hour: number }) => `${WEEKDAYS[c.weekday]} ${String(c.hour).padStart(2, '0')}:00`
    return (
        <ChartCard
            title="Best posting times"
            description={`Average engagement by weekday and hour (${timeZone}).`}
            loading={loading}
            skeleton="grid"
            summary={best.length ? `Best slots: ${best.map((c) => `${label(c)} (${formatExact(c.avgEngagement)} avg engagement)`).join(', ')}.` : 'Not enough published posts with metrics yet.'}
            table={
                <SimpleTable
                    head={['Slot', 'Posts', 'Avg engagement']}
                    rows={[...cells].sort((a, b) => b.avgEngagement - a.avgEngagement).map((c) => [label(c), c.posts, formatExact(c.avgEngagement)])}
                />
            }
        >
            {cells.length ? (
                <div className="overflow-x-auto">
                    <div className="grid min-w-max grid-cols-25 gap-1">
                        <span />
                        {Array.from({ length: 24 }, (_, h) => (
                            <span key={h} className="text-center text-meta">
                                {h % 3 === 0 ? h : ''}
                            </span>
                        ))}
                        {WEEKDAYS.map((day, weekday) => (
                            <div key={day} className="contents">
                                <span className="pe-2 text-meta">{day}</span>
                                {Array.from({ length: 24 }, (_, hour) => {
                                    const cell = at(weekday, hour)
                                    const step = cell && max > 0 ? Math.max(1, Math.ceil((cell.avgEngagement / max) * 5)) : 0
                                    return (
                                        <span
                                            key={hour}
                                            title={cell ? `${label(cell)}: ${formatExact(cell.avgEngagement)} avg engagement, ${cell.posts} post${cell.posts === 1 ? '' : 's'}` : undefined}
                                            className={cn('size-4 rounded-control', HEAT[step])}
                                        />
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <NoChartData message="Publish a few posts to see when your audience engages most." />
            )}
        </ChartCard>
    )
}

function NoChartData({ message = 'No data for this range yet.' }: { message?: string }) {
    return <p className="flex h-64 items-center justify-center text-meta">{message}</p>
}
