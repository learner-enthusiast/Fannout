import { httpLink, httpBatchStreamLink } from '@repo/trpc/client'
import { env } from '~/env'

/**
 * Browsers use NEXT_PUBLIC_API_URL as-is (a relative "/trpc" goes through the
 * Next.js rewrite). On the server a relative path has no origin, so call the
 * API directly at BASE_URL.
 */
function resolveTrpcUrl() {
    const url = env.NEXT_PUBLIC_API_URL ?? '/trpc'
    if (typeof window !== 'undefined' || !url.startsWith('/')) return url
    return `${(env.BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')}${url}`
}

interface CreateTRPCHttpBatchClientClientOpts {
    enableStreaming?: boolean
    getToken?: () => Promise<string | null>
}

export const createTRPCHttpBatchClientClient = (
    opts?: CreateTRPCHttpBatchClientClientOpts
) => {
    const c = opts?.enableStreaming ? httpBatchStreamLink : httpLink

    return c({
        url: resolveTrpcUrl(),
        headers: async () => {
            const token = await opts?.getToken?.()
            return token ? { Authorization: `Bearer ${token}` } : {}
        },
        fetch(url, options) {
            return fetch(url, {
                ...options,
                credentials: 'include',
            })
        },
    })
}
