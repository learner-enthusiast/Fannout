'use client'

import { CalendarClockIcon, ZapIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { browserTimezone, formatScheduled, fromLocalInput, minLocalInput, scheduleIssue, toLocalInput, type Schedule } from '~/lib/schedule'

/** Card header chip: "Scheduled · 7 Nov, 7:00 PM IST" / "Posts immediately". */
export function ScheduleChip({ schedule, inherited }: { schedule: Schedule | null; inherited?: boolean }) {
    if (!schedule) {
        return (
            <Badge variant="neutral">
                <ZapIcon aria-hidden />
                Posts immediately
            </Badge>
        )
    }
    return (
        <Badge variant="primary">
            <CalendarClockIcon aria-hidden />
            {`Scheduled · ${formatScheduled(schedule.at, schedule.timezone)}${inherited ? ' (schedule all)' : ''}`}
        </Badge>
    )
}

/** Per-card optional date-time picker (browser timezone); Clear = post instantly. */
export function ScheduleControl({
    value,
    onChange,
    error,
    fallback,
}: {
    value: Schedule | null
    onChange: (next: Schedule | null) => void
    error?: string
    /** "Schedule all" time this card inherits when it has none of its own. */
    fallback?: Schedule | null
}) {
    const timezone = value?.timezone ?? browserTimezone()
    const issue = error ?? scheduleIssue(value?.at ?? null)
    return (
        <FormField
            label={`Schedule (optional · ${timezone})`}
            error={issue ?? undefined}
            helper={
                !value && fallback
                    ? `Uses “Schedule all”: ${formatScheduled(fallback.at, fallback.timezone)}`
                    : value && fallback
                      ? 'Own time (overrides “Schedule all”)'
                      : 'Leave empty to post immediately.'
            }
        >
            {(control) => (
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        {...control}
                        type="datetime-local"
                        min={minLocalInput()}
                        value={value ? toLocalInput(value.at) : ''}
                        onChange={(event) => {
                            const at = fromLocalInput(event.target.value)
                            onChange(at ? { at, timezone: browserTimezone() } : null)
                        }}
                    />
                    {value ? (
                        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
                            Clear
                        </Button>
                    ) : null}
                </div>
            )}
        </FormField>
    )
}

/** Pick one time (Schedule all…, Reschedule). */
export function ScheduleDialog({
    open,
    onOpenChange,
    title,
    description,
    initial,
    confirmLabel,
    onConfirm,
    pending,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    initial: Schedule | null
    confirmLabel: string
    onConfirm: (schedule: Schedule | null) => void | Promise<void>
    pending?: boolean
}) {
    const [local, setLocal] = useState('')
    useEffect(() => {
        if (open) setLocal(initial ? toLocalInput(initial.at) : '')
    }, [open, initial])
    const at = fromLocalInput(local)
    const issue = scheduleIssue(at)
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <FormField label={`Date & time (${browserTimezone()})`} error={issue ?? undefined} required>
                    {(control) => (
                        <Input {...control} type="datetime-local" min={minLocalInput()} value={local} onChange={(e) => setLocal(e.target.value)} />
                    )}
                </FormField>
                <DialogFooter>
                    {initial ? (
                        <Button variant="ghost" onClick={() => void onConfirm(null)}>
                            Clear
                        </Button>
                    ) : null}
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        disabled={!at || Boolean(issue)}
                        loading={pending}
                        onClick={() => at && void onConfirm({ at, timezone: browserTimezone() })}
                    >
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
