'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { CalendarClockIcon, SendIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ScheduleDialog } from '~/components/compose/schedule-control'
import { Button } from '~/components/ui/button'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import { normalizeTRPCError } from '~/lib/error'
import { formatScheduled } from '~/lib/schedule'
import { trpc } from '~/trpc/client'

export type ScheduledPost = {
    id: string
    status: string
    schedule: { scheduledAt: Date | string; timezone: string; status: string; lastError: string | null } | null
}

const OPEN = ['scheduled', 'handed_off']

/** Scheduled time + countdown for a batch row ("in 12 min" / "Missed"). */
export function ScheduleSummary({ post }: { post: ScheduledPost }) {
    const s = post.schedule
    if (!s || !['scheduled', 'handed_off', 'missed'].includes(s.status) || post.status === 'published') return null
    const when = formatScheduled(s.scheduledAt, s.timezone)
    if (s.status === 'missed') return <span className="text-meta text-destructive">{`Missed — was due ${when}`}</span>
    const at = new Date(s.scheduledAt)
    const relative = at.getTime() > Date.now() ? formatDistanceToNowStrict(at, { addSuffix: true }) : 'now'
    return (
        <span className="text-meta">
            <CalendarClockIcon aria-hidden />
            {`${when} · ${relative}${s.status === 'handed_off' ? ' · preparing' : ''}`}
        </span>
    )
}

/** Reschedule (dialog), Post now, Cancel schedule; missed rows get "Publish now". */
export function ScheduleActions({ post, accountName, onChanged }: { post: ScheduledPost; accountName: string; onChanged: () => void }) {
    const [rescheduleOpen, setRescheduleOpen] = useState(false)
    const [cancelOpen, setCancelOpen] = useState(false)
    const onError = (error: unknown) => toast.error(normalizeTRPCError(error as never).message)
    const done = (message: string) => () => {
        toast.success(message)
        onChanged()
    }
    const reschedule = trpc.posts.reschedule.useMutation({ onSuccess: done('Rescheduled'), onError })
    const publishNow = trpc.posts.publishNow.useMutation({ onSuccess: done('Publishing now'), onError })
    const cancel = trpc.posts.cancelSchedule.useMutation({ onSuccess: done('Schedule cancelled'), onError })

    const s = post.schedule
    if (!s || post.status === 'published') return null
    if (s.status === 'missed') {
        return (
            <Button
                variant="primary"
                size="sm"
                leftIcon={<SendIcon aria-hidden />}
                loading={publishNow.isPending}
                onClick={() => publishNow.mutate({ postId: post.id })}
            >
                Missed — Publish now
            </Button>
        )
    }
    if (!OPEN.includes(s.status)) return null
    return (
        <>
            <Button variant="secondary" size="sm" leftIcon={<CalendarClockIcon aria-hidden />} onClick={() => setRescheduleOpen(true)}>
                Reschedule
            </Button>
            <Button
                variant="secondary"
                size="sm"
                leftIcon={<SendIcon aria-hidden />}
                loading={publishNow.isPending}
                onClick={() => publishNow.mutate({ postId: post.id })}
            >
                Post now
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<XIcon aria-hidden />} onClick={() => setCancelOpen(true)}>
                Cancel schedule
            </Button>
            <ScheduleDialog
                open={rescheduleOpen}
                onOpenChange={setRescheduleOpen}
                title="Reschedule"
                description={`New time for ${accountName}. Uploads already done are reused.`}
                initial={{ at: new Date(s.scheduledAt).toISOString(), timezone: s.timezone }}
                confirmLabel="Reschedule"
                pending={reschedule.isPending}
                onConfirm={async (next) => {
                    if (!next) return setCancelOpen(true)
                    await reschedule.mutateAsync({ postId: post.id, at: next.at, timezone: next.timezone }).catch(() => undefined)
                    setRescheduleOpen(false)
                }}
            />
            <ConfirmDialog
                open={cancelOpen}
                onOpenChange={setCancelOpen}
                title="Cancel this scheduled post?"
                description={`${accountName} won't get this post. You can't undo this.`}
                cancelLabel="Keep"
                confirmLabel="Cancel schedule"
                onConfirm={() => cancel.mutateAsync({ postId: post.id }).then(() => undefined)}
            />
        </>
    )
}

/** Only scheduled posts left unfinished → poll slowly (the time is far away). */
export const onlyWaitingOnSchedule = (posts: ScheduledPost[]) =>
    posts.every((p) => !['queued', 'publishing', 'deleting'].includes(p.status) && (p.status !== 'scheduled' || p.schedule?.status === 'scheduled'))
