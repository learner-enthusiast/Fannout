import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '~/lib/utils'

/**
 * Alert — a BLOCKING problem or important notice, placed inline at the top of
 * the section it affects. Always include a leading lucide icon. For action
 * results use a toast instead.
 */
const alertVariants = cva(
    'relative grid w-full gap-1 rounded-surface border px-4 py-3 text-start text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:size-4 *:[svg]:translate-y-0.5 *:[svg]:text-current has-[>svg]:[&>[data-slot]]:col-start-2',
    {
        variants: {
            variant: {
                info: 'border-border bg-card text-foreground',
                success: 'border-success/40 bg-card text-success',
                warning: 'border-warning/40 bg-card text-warning',
                destructive: 'border-destructive/40 bg-card text-destructive',
            },
        },
        defaultVariants: { variant: 'info' },
    }
)

function Alert({
    className,
    variant,
    ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
    return (
        <div
            data-slot="alert"
            role={variant === 'destructive' ? 'alert' : 'status'}
            className={cn(alertVariants({ variant }), className)}
            {...props}
        />
    )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-title"
            className={cn('text-label', className)}
            {...props}
        />
    )
}

function AlertDescription({
    className,
    ...props
}: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-description"
            className={cn(
                'text-meta text-muted-foreground [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4',
                className
            )}
            {...props}
        />
    )
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="alert-action"
            className={cn('mt-2 flex gap-2', className)}
            {...props}
        />
    )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
