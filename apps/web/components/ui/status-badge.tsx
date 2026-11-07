import {
    CircleAlertIcon,
    CircleCheckIcon,
    CircleDashedIcon,
    ClockAlertIcon,
    LinkIcon,
    LoaderCircleIcon,
    RefreshCwOffIcon,
    UploadIcon,
    type LucideIcon,
} from 'lucide-react'

import { Badge } from '~/components/ui/badge'

/**
 * StatusBadge — the ONLY way to show a status. Maps status → colour + icon +
 * text (DESIGN.md §4.1): success = published/connected, warning =
 * processing/expiring, destructive = failed/reconnect, muted = pending.
 */
export const statusMap = {
    published: {
        label: 'Published',
        variant: 'success',
        icon: CircleCheckIcon,
    },
    connected: { label: 'Connected', variant: 'success', icon: LinkIcon },
    ready: { label: 'Ready', variant: 'success', icon: CircleCheckIcon },
    uploading: { label: 'Uploading', variant: 'warning', icon: UploadIcon },
    processing: {
        label: 'Processing',
        variant: 'warning',
        icon: LoaderCircleIcon,
    },
    expiring: {
        label: 'Expiring soon',
        variant: 'warning',
        icon: ClockAlertIcon,
    },
    failed: { label: 'Failed', variant: 'destructive', icon: CircleAlertIcon },
    reconnect: {
        label: 'Reconnect required',
        variant: 'destructive',
        icon: RefreshCwOffIcon,
    },
    pending: { label: 'Pending', variant: 'neutral', icon: CircleDashedIcon },
} as const satisfies Record<
    string,
    {
        label: string
        variant: 'success' | 'warning' | 'destructive' | 'neutral'
        icon: LucideIcon
    }
>

export type Status = keyof typeof statusMap

export function StatusBadge({
    status,
    label,
}: {
    status: Status
    /** Override the default text (keep it short). */
    label?: string
}) {
    const { variant, icon: Icon, label: defaultLabel } = statusMap[status]
    return (
        <Badge variant={variant} data-status={status}>
            <Icon aria-hidden />
            {label ?? defaultLabel}
        </Badge>
    )
}
