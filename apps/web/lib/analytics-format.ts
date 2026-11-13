import type { LucideIcon } from 'lucide-react'

import { providers } from '~/components/connections/providers'

export type AnalyticsPlatform = 'youtube' | 'x' | 'linkedin' | 'threads' | 'facebook' | 'instagram'

/** Absent metrics (null/undefined) always render as an em dash — never 0. */
export const NONE = '—'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const exact = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })

/** 1.2K style, for axes and tiles. */
export const formatCompact = (value: number | null | undefined) => (typeof value === 'number' ? compact.format(value) : NONE)
/** 1,234 style, for tooltips and tables. */
export const formatExact = (value: number | null | undefined) => (typeof value === 'number' ? exact.format(value) : NONE)

export const formatPercent = (value: number | null | undefined) =>
    typeof value === 'number' ? `${value.toFixed(value >= 10 ? 0 : 1)}%` : NONE

/** 3h 25m / 4m 10s / 12s. */
export function formatDuration(seconds: number | null | undefined) {
    if (typeof seconds !== 'number') return NONE
    const s = Math.round(seconds)
    if (s >= 3600) return `${compact.format(Math.floor(s / 3600))}h ${Math.floor((s % 3600) / 60)}m`
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
    return `${s}s`
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' })
/** "2 h ago" style. */
export function formatRelative(iso: string | null | undefined) {
    if (!iso) return null
    const diff = (Date.parse(iso) - Date.now()) / 1000
    const abs = Math.abs(diff)
    if (abs < 60) return relative.format(Math.round(diff), 'second')
    if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute')
    if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour')
    return relative.format(Math.round(diff / 86400), 'day')
}

export const formatDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : NONE

/** Label, icon and chart colour token per platform (colours from globals.css only). */
export function platformMeta(platform: AnalyticsPlatform | null | undefined): { label: string; icon: LucideIcon | null; color: string } {
    const provider = providers.find((p) => p.slug === platform)
    return {
        label: provider?.name ?? 'Unknown',
        icon: provider?.icon ?? null,
        color: platform ? `var(--chart-${platform})` : 'var(--chart-1)',
    }
}

/** Formatter per normalized metric key (durations vs counts). */
export function formatMetric(key: string, value: number | null | undefined, mode: 'compact' | 'exact' = 'compact') {
    if (key.endsWith('_seconds')) return formatDuration(value)
    return mode === 'compact' ? formatCompact(value) : formatExact(value)
}

export const METRIC_LABELS: Record<string, string> = {
    views: 'Views',
    impressions: 'Impressions',
    reach: 'Reach',
    likes: 'Likes',
    comments: 'Comments',
    shares: 'Shares',
    saves: 'Saves',
    reposts: 'Reposts',
    quotes: 'Quotes',
    bookmarks: 'Bookmarks',
    clicks: 'Clicks',
    watch_time_seconds: 'Watch time',
    avg_view_duration_seconds: 'Avg view duration',
    followers: 'Followers',
    followers_gained: 'Followers gained',
    followers_lost: 'Followers lost',
    profile_views: 'Profile views',
    engagements: 'Engagements',
    video_views: 'Video views',
}

/** Per-platform wording for a normalized key (Threads/YouTube say replies/subscribers). */
export function metricLabel(key: string, platform?: AnalyticsPlatform | null) {
    if (platform === 'threads' && key === 'comments') return 'Replies'
    if (platform === 'youtube' && key === 'followers_gained') return 'Subscribers gained'
    if (platform === 'youtube' && key === 'followers_lost') return 'Subscribers lost'
    return METRIC_LABELS[key] ?? key
}

/** Metrics where a rise is bad (delta colour flips). */
export const LOWER_IS_BETTER = new Set(['followers_lost'])
