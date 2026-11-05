import type { ServerRouter } from '@repo/trpc/client'
import { createTRPCProxyClient } from '@repo/trpc/client'
import { createTRPCHttpBatchClientClient } from '~/trpc/create-client'

export function createServerApi(getToken: () => Promise<string | null>) {
    return createTRPCProxyClient<ServerRouter>({
        links: [createTRPCHttpBatchClientClient({ getToken })],
    })
}
