import { useSyncExternalStore } from 'react'

/** Subscribe to a CSS media query (false on the server). */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (notify) => {
            const mql = window.matchMedia(query)
            mql.addEventListener('change', notify)
            return () => mql.removeEventListener('change', notify)
        },
        () => window.matchMedia(query).matches,
        () => false
    )
}
