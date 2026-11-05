'use client'

import { useState } from 'react'
import { FacebookIcon, YoutubeIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog'
import { Skeleton } from '~/components/ui/skeleton'
import { trpc } from '~/trpc/client'

/** Shown after Google returns more than one YouTube channel. */
export function ChannelSelectionDialog({
    selectionId,
    onClose,
}: {
    selectionId: string
    onClose: () => void
}) {
    const utils = trpc.useUtils()
    const [selected, setSelected] = useState<string[]>([])
    const selection = trpc.socialConnections.channelSelection.useQuery(
        { id: selectionId },
        { retry: false }
    )
    const finalize =
        trpc.socialConnections.finalizeChannelSelection.useMutation({
            onSuccess: async ({ connectionIds }) => {
                toast.success(
                    connectionIds.length === 1
                        ? 'Account connected'
                        : `${connectionIds.length} accounts connected`
                )
                await utils.socialConnections.list.invalidate()
                onClose()
            },
        })

    const isFacebook = selection.data?.provider === 'FACEBOOK'
    const noun = isFacebook ? 'Facebook Pages' : 'YouTube channels'
    const FallbackIcon = isFacebook ? FacebookIcon : YoutubeIcon

    const toggle = (id: string, checked: boolean) =>
        setSelected((current) =>
            checked ? [...current, id] : current.filter((c) => c !== id)
        )

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{`Choose ${noun}`}</DialogTitle>
                    <DialogDescription>
                        {selection.data?.accountLabel
                            ? `${selection.data.accountLabel} manages more than one. Pick the ${noun} Fannout can use.`
                            : `Pick the ${noun} Fannout can use.`}
                    </DialogDescription>
                </DialogHeader>

                {selection.isPending ? (
                    <div className="flex flex-col gap-2">
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10" />
                    </div>
                ) : selection.isError ? (
                    <p className="text-sm text-destructive">
                        This selection has expired. Please connect again.
                    </p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {selection.data.channels.map((channel) => (
                            <li key={channel.id}>
                                <label className="flex cursor-pointer items-center gap-3 rounded-control border border-border p-3">
                                    <Checkbox
                                        checked={selected.includes(channel.id)}
                                        onCheckedChange={(checked) =>
                                            toggle(channel.id, checked)
                                        }
                                    />
                                    <Avatar>
                                        {channel.thumbnailUrl ? (
                                            <AvatarImage
                                                src={channel.thumbnailUrl}
                                                alt=""
                                            />
                                        ) : null}
                                        <AvatarFallback>
                                            <FallbackIcon aria-hidden />
                                        </AvatarFallback>
                                    </Avatar>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-label text-foreground">
                                            {channel.title ?? channel.id}
                                        </span>
                                        {channel.handle ? (
                                            <span className="truncate text-meta text-muted-foreground">
                                                {channel.handle}
                                            </span>
                                        ) : null}
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                )}

                <DialogFooter>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        disabled={selected.length === 0 || !selection.data}
                        loading={finalize.isPending}
                        onClick={() =>
                            finalize.mutate({
                                id: selectionId,
                                channelIds: selected,
                            })
                        }
                    >
                        Connect Selected
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
