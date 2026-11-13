'use client'

import { RotateCcwIcon } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Fragment, type ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import type { InfiniteList as List } from '~/hooks/use-infinite-list'
import { normalizeTRPCError } from '~/lib/error'
import { cn } from '~/lib/utils'

/**
 * The one way to render a paginated list (docs/conventions/frontend.md):
 * items + an IntersectionObserver sentinel (200 px early) that loads the
 * next page, skeletons while loading, inline retry, "No more items", and an
 * EmptyState when there's nothing.
 */
export function InfiniteList<T>({
    list,
    renderItem,
    getKey,
    skeleton,
    skeletonCount = 3,
    empty,
    className,
    container,
    root = null,
    endLabel = 'No more items',
    virtual,
}: {
    list: List<T>
    renderItem: (item: T, index: number) => ReactNode
    getKey: (item: T) => string
    /** One placeholder item (repeated while loading). */
    skeleton: ReactNode
    skeletonCount?: number
    empty: ReactNode
    /** Classes for the default <ul> container (e.g. a grid). */
    className?: string
    /** Custom container (e.g. a table body); receives the rendered rows. */
    container?: (children: ReactNode) => ReactNode
    /** Scroll container for the sentinel (popovers/dialogs); null = viewport. */
    root?: Element | null
    endLabel?: string
    /**
     * Windowing for long lists (rule: lists > 30 items are virtualized). Needs a `root`
     * scroll container with a fixed max height. Replaces `className`/`container`:
     * rows are laid out as `columns`-wide grids.
     */
    virtual?: { estimateSize: number; columns?: number; gap?: number }
}) {
    const sentinel = useInfiniteScroll({ hasMore: list.hasMore && !list.isError, loading: list.isFetchingMore, onLoadMore: list.loadMore, root })
    const wrap = container ?? ((children: ReactNode) => <ul className={className}>{children}</ul>)
    const skeletons = (n: number) =>
        Array.from({ length: n }, (_, i) => (
            <li key={`skeleton-${i}`} aria-hidden className="list-none">
                {skeleton}
            </li>
        ))

    if (list.isLoading) {
        // Custom containers (tables) get plain placeholders outside the container.
        return container ? (
            <div aria-busy className="flex flex-col gap-2">
                {Array.from({ length: skeletonCount }, (_, i) => (
                    <div key={i} aria-hidden>
                        {skeleton}
                    </div>
                ))}
            </div>
        ) : (
            <div aria-busy>{wrap(skeletons(skeletonCount))}</div>
        )
    }

    if (list.items.length === 0 && list.isError) {
        return <ListError message={normalizeTRPCError(list.error).message} onRetry={list.retry} />
    }
    if (list.items.length === 0) return <>{empty}</>

    const windowed = Boolean(virtual && root && list.items.length > VIRTUALIZE_AFTER)

    return (
        <div className={cn('flex flex-col gap-4 transition-opacity duration-fast', list.isStale && 'opacity-60')} aria-busy={list.isFetchingMore || undefined}>
            {windowed && virtual && root ? (
                <VirtualRows items={list.items} renderItem={renderItem} getKey={getKey} root={root} {...virtual} />
            ) : (
            wrap(
                <>
                    {list.items.map((item, index) => (
                        <Fragment key={getKey(item)}>{renderItem(item, index)}</Fragment>
                    ))}
                    {list.isFetchingMore && !container ? skeletons(Math.min(skeletonCount, 3)) : null}
                </>
            ))}
            {(container || windowed) && list.isFetchingMore ? <div aria-hidden>{skeleton}</div> : null}
            <div ref={sentinel} aria-hidden className="h-1" />
            {list.isError ? (
                <ListError message={normalizeTRPCError(list.error).message} onRetry={list.retry} />
            ) : !list.hasMore ? (
                <p className="text-center text-meta">{endLabel}</p>
            ) : null}
        </div>
    )
}

/** Lists longer than this render only the rows near the viewport. */
export const VIRTUALIZE_AFTER = 30

function VirtualRows<T>({
    items,
    renderItem,
    getKey,
    root,
    estimateSize,
    columns = 1,
    gap = 8,
}: {
    items: T[]
    renderItem: (item: T, index: number) => ReactNode
    getKey: (item: T) => string
    root: Element
    estimateSize: number
    columns?: number
    gap?: number
}) {
    const rowCount = Math.ceil(items.length / columns)
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => root as HTMLElement,
        estimateSize: () => estimateSize + gap,
        overscan: 4,
        // Row index depends on the column count; re-key rows when it changes.
        getItemKey: (row) => `${columns}:${row}`,
    })
    return (
        <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => (
                <li
                    key={row.key}
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    className="absolute start-0 top-0 w-full list-none"
                    style={{ transform: `translateY(${row.start}px)`, paddingBottom: gap }}
                >
                    <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}>
                        {items.slice(row.index * columns, row.index * columns + columns).map((item, offset) => (
                            <Fragment key={getKey(item)}>{renderItem(item, row.index * columns + offset)}</Fragment>
                        ))}
                    </ul>
                </li>
            ))}
        </ul>
    )
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex flex-wrap items-center justify-center gap-2 text-meta" role="alert">
            <span>Couldn&rsquo;t load more: {message}</span>
            <Button variant="secondary" size="sm" leftIcon={<RotateCcwIcon aria-hidden />} onClick={onRetry}>
                Retry
            </Button>
        </div>
    )
}
