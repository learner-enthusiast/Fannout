import * as React from 'react'

import { cn } from '~/lib/utils'

/**
 * Card — the content surface (bg-card + 1px border + radius-surface, no
 * shadow). Padding 24px (16px below md). Use full composition:
 * CardHeader → CardTitle/CardDescription (+ CardAction), CardContent,
 * CardFooter. Primary action in CardFooter sits on the right.
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card"
            className={cn(
                'group/card flex flex-col gap-4 overflow-hidden rounded-surface border border-border bg-card py-4 text-sm text-card-foreground md:gap-6 md:py-6',
                className
            )}
            {...props}
        />
    )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-header"
            className={cn(
                '@container/card-header grid auto-rows-min items-start gap-1 px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] md:px-6',
                className
            )}
            {...props}
        />
    )
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
    return (
        <h3
            data-slot="card-title"
            className={cn('text-section-title text-foreground', className)}
            {...props}
        />
    )
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
    return (
        <p
            data-slot="card-description"
            className={cn('text-meta text-muted-foreground', className)}
            {...props}
        />
    )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-action"
            className={cn(
                'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
                className
            )}
            {...props}
        />
    )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-content"
            className={cn('px-4 md:px-6', className)}
            {...props}
        />
    )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-footer"
            className={cn(
                'flex items-center justify-end gap-2 px-4 md:px-6',
                className
            )}
            {...props}
        />
    )
}

export {
    Card,
    CardHeader,
    CardFooter,
    CardTitle,
    CardAction,
    CardDescription,
    CardContent,
}
