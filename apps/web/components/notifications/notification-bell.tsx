'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import {
    BellIcon,
    CircleAlertIcon,
    CircleCheckIcon,
    TriangleAlertIcon,
    type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { RouterOutputs } from '@repo/trpc/client'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '~/components/ui/popover'
import { Skeleton } from '~/components/ui/skeleton'
import { Spinner } from '~/components/ui/spinner'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'

type Notification = RouterOutputs['notifications']['list']['items'][number]

const tone: Record<Notification['type'], { icon: LucideIcon; className: string; label: string }> = {
    upload_succeeded: { icon: CircleCheckIcon, className: 'text-success', label: 'Success' },
    post_published: { icon: CircleCheckIcon, className: 'text-success', label: 'Success' },
    post_scheduled: { icon: CircleCheckIcon, className: 'text-success', label: 'Success' },
    upload_failed: { icon: CircleAlertIcon, className: 'text-destructive', label: 'Failed' },
    post_failed: { icon: CircleAlertIcon, className: 'text-destructive', label: 'Failed' },
    schedule_failed: { icon: TriangleAlertIcon, className: 'text-warning', label: 'Needs attention' },
}

const PAGE_SIZE = 20

function NotificationRow({
    item,
    onOpen,
}: {
    item: Notification
    onOpen: (item: Notification) => void
}) {
    const { icon: Icon, className, label } = tone[item.type]
    const unread = !item.readAt
    return (
        <li>
            <button
                type="button"
                onClick={() => onOpen(item)}
                className="flex w-full items-start gap-3 rounded-control px-2 py-2 text-start outline-none transition-colors duration-fast ease-out hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-card"
            >
                <Icon aria-label={label} className={cn('mt-0.5 size-4 shrink-0', className)} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={cn('text-label', unread ? 'text-foreground' : 'text-muted-foreground')}>
                        {item.title}
                    </span>
                    {item.body ? <span className="text-meta">{item.body}</span> : null}
                    <span className="text-meta">
                        {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
                    </span>
                </span>
                {unread ? (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">Unread</span>
                    </span>
                ) : null}
            </button>
        </li>
    )
}

/** Header bell: unread badge + popover list with infinite scroll. */
export function NotificationBell() {
    const router = useRouter()
    const utils = trpc.useUtils()
    const [open, setOpen] = useState(false)
    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)

    const unread = trpc.notifications.unreadCount.useQuery(undefined, {
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        staleTime: 0,
    })
    const list = trpc.notifications.list.useInfiniteQuery(
        { limit: PAGE_SIZE },
        {
            enabled: open,
            staleTime: 0,
            getNextPageParam: (last) => last.nextCursor ?? undefined,
        }
    )

    const refresh = () => {
        void utils.notifications.unreadCount.invalidate()
        void utils.notifications.list.invalidate()
    }
    const markRead = trpc.notifications.markRead.useMutation({ onSettled: refresh })
    const markAll = trpc.notifications.markAllRead.useMutation({ onSettled: refresh })

    const sentinel = useInfiniteScroll({
        hasMore: Boolean(list.hasNextPage),
        loading: list.isFetchingNextPage,
        onLoadMore: () => void list.fetchNextPage(),
        root: scrollRoot,
    })

    const count = unread.data?.count ?? 0
    const items = list.data?.pages.flatMap((page) => page.items) ?? []

    const openItem = (item: Notification) => {
        if (!item.readAt) markRead.mutate({ ids: [item.id] })
        setOpen(false)
        if (item.link) router.push(item.link)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
                        className="relative"
                    />
                }
            >
                <BellIcon aria-hidden />
                {count > 0 ? (
                    <span className="pointer-events-none absolute -top-1 -end-1">
                        <Badge variant="primary">{count > 99 ? '99+' : count}</Badge>
                    </span>
                ) : null}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 gap-2 p-2">
                <PopoverHeader>
                    <div className="flex items-center justify-between gap-2 px-2 pt-2">
                        <PopoverTitle>Notifications</PopoverTitle>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={count === 0}
                            loading={markAll.isPending}
                            onClick={() => markAll.mutate()}
                        >
                            Mark All as Read
                        </Button>
                    </div>
                </PopoverHeader>
                <div ref={setScrollRoot} className="max-h-120 overflow-y-auto">
                    {list.isPending ? (
                        <ul className="flex flex-col gap-2 p-2" aria-busy>
                            {[0, 1, 2].map((i) => (
                                <li key={i} className="flex gap-3">
                                    <Skeleton className="size-4 rounded-full" />
                                    <div className="flex flex-1 flex-col gap-2">
                                        <Skeleton className="h-4 w-2/3" />
                                        <Skeleton className="h-3 w-1/3" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : items.length === 0 ? (
                        <p className="px-2 py-8 text-center text-meta">You&rsquo;re all caught up.</p>
                    ) : (
                        <ul className="flex flex-col">
                            {items.map((item) => (
                                <NotificationRow key={item.id} item={item} onOpen={openItem} />
                            ))}
                        </ul>
                    )}
                    <div ref={sentinel} aria-hidden className="h-1" />
                    {list.isFetchingNextPage ? (
                        <div className="flex justify-center py-2">
                            <Spinner />
                        </div>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    )
}
