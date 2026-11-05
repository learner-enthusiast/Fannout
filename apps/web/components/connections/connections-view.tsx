'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { useRouter, useSearchParams } from 'next/navigation'
import { CircleAlertIcon, Link2OffIcon, PlugIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { RouterOutputs } from '@repo/trpc/client'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '~/components/ui/card'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import { Skeleton } from '~/components/ui/skeleton'
import { StatusBadge } from '~/components/ui/status-badge'
import { apiOrigin } from '~/lib/api-origin'
import { getErrorMessage } from '~/lib/error'
import { trpc } from '~/trpc/client'

import { ChannelSelectionDialog } from './channel-selection-dialog'
import {
    defaultFailureMessage,
    failureMessages,
    providers,
    type ProviderSlug,
} from './providers'

type Connection =
    RouterOutputs['socialConnections']['list']['connections'][number]

/**
 * Starts the OAuth flow. The API call carries the Clerk token, sets the
 * browser-binding cookie and returns the provider URL; tokens never reach
 * the browser.
 */
async function startConnect(
    slug: ProviderSlug,
    getToken: () => Promise<string | null>
) {
    const token = await getToken()
    const response = await fetch(
        `${apiOrigin()}/api/oauth/${slug}/connect?returnTo=${encodeURIComponent('/connections')}`,
        {
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        }
    )
    const body = (await response.json().catch(() => null)) as {
        authorizationUrl?: string
        error?: { message?: string }
    } | null
    if (!response.ok || !body?.authorizationUrl) {
        throw new Error(body?.error?.message ?? 'Could not start the connection')
    }
    window.location.assign(body.authorizationUrl)
}

/** Reads ?oauth=… once after the callback redirect, then cleans the URL. */
function useOAuthResult(onSelection: (id: string) => void) {
    const params = useSearchParams()
    const router = useRouter()
    const handled = useRef(false)

    useEffect(() => {
        const result = params.get('oauth')
        if (!result || handled.current) return
        handled.current = true
        const name =
            providers.find((p) => p.slug === params.get('provider'))?.name ??
            'Account'

        if (result === 'connected') toast.success(`${name} connected`)
        else if (result === 'select_channel') {
            const selection = params.get('selection')
            if (selection) onSelection(selection)
        } else {
            toast.error(
                failureMessages[params.get('reason') ?? ''] ??
                    defaultFailureMessage
            )
        }
        router.replace('/connections', { scroll: false })
    }, [params, router, onSelection])
}

function ConnectionRow({ connection }: { connection: Connection }) {
    const utils = trpc.useUtils()
    const disconnect = trpc.socialConnections.disconnect.useMutation({
        onSuccess: async () => {
            toast.success('Account disconnected')
            await utils.socialConnections.list.invalidate()
        },
    })
    const name =
        connection.displayName ?? connection.username ?? 'Connected account'

    return (
        <li className="flex flex-col gap-3 rounded-control border border-border p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar size="lg">
                    {connection.profilePictureUrl ? (
                        <AvatarImage src={connection.profilePictureUrl} alt="" />
                    ) : null}
                    <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-label text-foreground">
                        {name}
                    </span>
                    {connection.username ? (
                        <span className="truncate text-meta text-muted-foreground">
                            {connection.username.startsWith('@')
                                ? connection.username
                                : `@${connection.username}`}
                        </span>
                    ) : null}
                </div>
            </div>
            <div className="flex items-center gap-2">
                {connection.status === 'connected' ? (
                    <StatusBadge status="connected" />
                ) : connection.status === 'reconnect' ? (
                    <StatusBadge status="reconnect" />
                ) : (
                    <StatusBadge status="pending" label="Disconnected" />
                )}
                {connection.status !== 'disconnected' ? (
                    <ConfirmDialog
                        trigger={
                            <Button
                                variant="ghost"
                                size="sm"
                                leftIcon={<Link2OffIcon aria-hidden />}
                            >
                                Disconnect
                            </Button>
                        }
                        title={`Disconnect ${name}?`}
                        description="Fannout will delete the stored access for this account. You can connect it again at any time."
                        confirmLabel="Disconnect"
                        onConfirm={async () => {
                            await disconnect.mutateAsync({ id: connection.id })
                        }}
                    />
                ) : null}
            </div>
        </li>
    )
}

export function ConnectionsView() {
    const { getToken } = useAuth()
    const [connecting, setConnecting] = useState<ProviderSlug | null>(null)
    const [selectionId, setSelectionId] = useState<string | null>(null)
    const list = trpc.socialConnections.list.useQuery()
    useOAuthResult(setSelectionId)

    async function connect(slug: ProviderSlug) {
        setConnecting(slug)
        try {
            await startConnect(slug, getToken)
        } catch (error) {
            toast.error(getErrorMessage(error))
            setConnecting(null)
        }
    }

    if (list.isError) {
        return (
            <Alert variant="destructive">
                <CircleAlertIcon aria-hidden />
                <AlertTitle>Connections could not be loaded</AlertTitle>
                <AlertDescription>{getErrorMessage(list.error)}</AlertDescription>
            </Alert>
        )
    }

    return (
        <div className="flex flex-col gap-6">
            {providers.map((provider) => {
                const Icon = provider.icon
                const connections =
                    list.data?.connections.filter(
                        (c) => c.provider === provider.value
                    ) ?? []
                const configured = list.data?.providers[provider.slug] ?? true

                return (
                    <Card key={provider.slug}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Icon aria-hidden className="size-4" />
                                {provider.name}
                            </CardTitle>
                            <CardDescription>
                                {provider.description}
                            </CardDescription>
                            <CardAction>
                                {configured ? (
                                    <Button
                                        variant="primary"
                                        leftIcon={<PlugIcon aria-hidden />}
                                        loading={connecting === provider.slug}
                                        disabled={
                                            list.isPending ||
                                            (connecting !== null &&
                                                connecting !== provider.slug)
                                        }
                                        onClick={() => connect(provider.slug)}
                                    >
                                        {`Connect ${provider.name}`}
                                    </Button>
                                ) : (
                                    <Badge variant="neutral">
                                        Not configured
                                    </Badge>
                                )}
                            </CardAction>
                        </CardHeader>
                        <CardContent>
                            {list.isPending ? (
                                <Skeleton className="h-16" />
                            ) : connections.length === 0 ? (
                                <p className="text-meta text-muted-foreground">
                                    No {provider.name} account connected yet.
                                </p>
                            ) : (
                                <ul className="flex flex-col gap-2">
                                    {connections.map((connection) => (
                                        <ConnectionRow
                                            key={connection.id}
                                            connection={connection}
                                        />
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                )
            })}

            {selectionId ? (
                <ChannelSelectionDialog
                    selectionId={selectionId}
                    onClose={() => setSelectionId(null)}
                />
            ) : null}
        </div>
    )
}
