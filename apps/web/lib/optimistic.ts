import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Optimistic-update helpers (docs/conventions/frontend.md → Mutations).
 * Snapshot every cached query under a key prefix, change them, and restore
 * the snapshot if the mutation fails.
 */

export type Snapshot = { key: QueryKey; data: unknown }[]

type InfinitePages<T> = { pages: { items: T[]; nextCursor: string | null }[]; pageParams: unknown[] }

const isInfinite = <T,>(data: unknown): data is InfinitePages<T> =>
    typeof data === 'object' && data !== null && Array.isArray((data as { pages?: unknown }).pages)

/**
 * Removes matching items from EVERY page of every cached infinite query
 * under `queryKey` (all inputs/filters). Returns the snapshot to restore.
 */
export function removeFromInfiniteCache<T>(queryClient: QueryClient, queryKey: QueryKey, predicate: (item: T) => boolean): Snapshot {
    const snapshot: Snapshot = []
    for (const [key, data] of queryClient.getQueriesData({ queryKey })) {
        if (!isInfinite<T>(data)) continue
        snapshot.push({ key, data })
        queryClient.setQueryData(key, {
            ...data,
            pages: data.pages.map((page) => ({ ...page, items: page.items.filter((item) => !predicate(item)) })),
        })
    }
    return snapshot
}

/** Applies `update` to every cached (non-infinite or infinite) query under `queryKey`. */
export function updateCache<D>(queryClient: QueryClient, queryKey: QueryKey, update: (data: D) => D): Snapshot {
    const snapshot: Snapshot = []
    for (const [key, data] of queryClient.getQueriesData<D>({ queryKey })) {
        if (data === undefined) continue
        snapshot.push({ key, data })
        queryClient.setQueryData(key, update(data))
    }
    return snapshot
}

export function restoreSnapshot(queryClient: QueryClient, ...snapshots: Snapshot[]) {
    for (const snapshot of snapshots) for (const { key, data } of snapshot) queryClient.setQueryData(key, data)
}
