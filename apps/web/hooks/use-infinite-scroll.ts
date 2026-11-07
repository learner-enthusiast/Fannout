'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Returns a ref for a sentinel element; `onLoadMore` fires when it scrolls
 * into view (inside `root`, or the viewport when root is null).
 */
export function useInfiniteScroll({
    hasMore,
    loading,
    onLoadMore,
    root = null,
}: {
    hasMore: boolean
    loading: boolean
    onLoadMore: () => void
    root?: Element | null
}) {
    const observer = useRef<IntersectionObserver | null>(null)
    const latest = useRef({ hasMore, loading, onLoadMore })
    useEffect(() => {
        latest.current = { hasMore, loading, onLoadMore }
    })

    useEffect(() => () => observer.current?.disconnect(), [])

    return useCallback(
        (node: Element | null) => {
            observer.current?.disconnect()
            if (!node) return
            observer.current = new IntersectionObserver(
                (entries) => {
                    const { hasMore, loading, onLoadMore } = latest.current
                    if (entries.some((e) => e.isIntersecting) && hasMore && !loading)
                        onLoadMore()
                },
                { root, rootMargin: '200px' }
            )
            observer.current.observe(node)
        },
        [root]
    )
}
