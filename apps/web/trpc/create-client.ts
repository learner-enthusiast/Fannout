import { httpLink, httpBatchStreamLink } from '@repo/trpc/client'
import { env } from '~/env'

interface CreateTRPCHttpBatchClientClientOpts {
    enableStreaming?: boolean
    getToken?: () => Promise<string | null>
}

export const createTRPCHttpBatchClientClient = (
    opts?: CreateTRPCHttpBatchClientClientOpts
) => {
    const c = opts?.enableStreaming ? httpBatchStreamLink : httpLink

    return c({
        url: env.NEXT_PUBLIC_API_URL ?? '/trpc',
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
