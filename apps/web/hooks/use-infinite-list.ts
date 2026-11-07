'use client'

import { keepPreviousData } from '@tanstack/react-query'

/** One page from any paginated endpoint ({ items, nextCursor }). */
export type Page<T> = { items: T[]; nextCursor: string | null }

/** The parts of an infinite query result the list UI needs (tRPC's result fits). */
export type InfiniteQueryLike<T> = {
    data?: { pages: Page<T>[] }
    isPending: boolean
    isError: boolean
    error: unknown
    hasNextPage: boolean
    isFetchingNextPage: boolean
    isPlaceholderData?: boolean
    fetchNextPage: () => unknown
    refetch: () => unknown
}

/**
 * Options for `trpc.x.list.useInfiniteQuery(input, infiniteOptions())`:
 * next cursor from the page, and the previous results stay visible while a
 * new search/filter loads its first page.
 */
export function infiniteOptions<E extends object>(extra?: E) {
    return {
        getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
        placeholderData: keepPreviousData,
        ...extra,
    } as const
}

export type InfiniteList<T> = {
    items: T[]
    hasMore: boolean
    /** First page, nothing cached yet. */
    isLoading: boolean
    isFetchingMore: boolean
    isError: boolean
    error: unknown
    /** Showing old results while a new search/filter loads. */
    isStale: boolean
    loadMore: () => void
    retry: () => void
}

/** Flattens an infinite query into a list (wraps useInfiniteQuery's result). */
export function useInfiniteList<T>(query: InfiniteQueryLike<T>): InfiniteList<T> {
    const items = query.data?.pages.flatMap((page) => page.items) ?? []
    return {
        items,
        hasMore: Boolean(query.hasNextPage),
        isLoading: query.isPending && !query.data,
        isFetchingMore: query.isFetchingNextPage,
        isError: query.isError,
        error: query.error,
        isStale: Boolean(query.isPlaceholderData),
        loadMore: () => void query.fetchNextPage(),
        retry: () => void (query.hasNextPage && items.length ? query.fetchNextPage() : query.refetch()),
    }
}
