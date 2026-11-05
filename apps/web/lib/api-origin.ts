import { env } from '~/env'

/**
 * Origin of the Express API, derived from NEXT_PUBLIC_API_URL
 * ("http://localhost:8000/trpc" → "http://localhost:8000"). Empty string when
 * the API is proxied under the same origin ("/trpc").
 */
export function apiOrigin(): string {
    const url = env.NEXT_PUBLIC_API_URL
    if (!url || url.startsWith('/')) return ''
    return new URL(url).origin
}
