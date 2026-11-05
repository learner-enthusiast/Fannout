'use client'

import {
    CircleAlertIcon,
    CircleCheckIcon,
    InfoIcon,
    Loader2Icon,
    TriangleAlertIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Toaster — mount once (GlobalProviders). Trigger with `toast.success()` /
 * `toast.error()` from 'sonner' for ACTION RESULTS only. Bottom-right, 4s,
 * icon + text, themed from tokens.
 */
function Toaster(props: ToasterProps) {
    const { resolvedTheme } = useTheme()

    return (
        <Sonner
            theme={resolvedTheme === 'light' ? 'light' : 'dark'}
            position="bottom-right"
            duration={4000}
            className="toaster group"
            icons={{
                success: <CircleCheckIcon className="size-4 text-success" />,
                info: <InfoIcon className="size-4 text-foreground" />,
                warning: <TriangleAlertIcon className="size-4 text-warning" />,
                error: <CircleAlertIcon className="size-4 text-destructive" />,
                loading: <Loader2Icon className="size-4 animate-spin" />,
            }}
            style={
                {
                    '--normal-bg': 'var(--popover)',
                    '--normal-text': 'var(--popover-foreground)',
                    '--normal-border': 'var(--border)',
                    '--border-radius': 'var(--radius-surface)',
                } as React.CSSProperties
            }
            toastOptions={{
                classNames: {
                    toast: 'font-sans text-sm shadow-float!',
                    description: 'text-meta text-muted-foreground!',
                    success: 'border-success/40!',
                    error: 'border-destructive/40!',
                },
            }}
            {...props}
        />
    )
}

export { Toaster }
