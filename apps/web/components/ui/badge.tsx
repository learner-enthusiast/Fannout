import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '~/lib/utils'

/**
 * Badge — short label/count. For a STATUS use `<StatusBadge>` (it adds the
 * icon + text mapping). If you use a status variant directly, include a
 * leading icon: status is never colour-only.
 */
const badgeVariants = cva(
    'inline-flex h-6 w-fit shrink-0 items-center gap-1 overflow-hidden rounded-control border px-2 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5 [&>svg]:shrink-0',
    {
        variants: {
            variant: {
                neutral: 'border-border bg-muted text-muted-foreground',
                primary:
                    'border-transparent bg-primary text-primary-foreground',
                success: 'border-success/30 bg-success/10 text-success',
                warning: 'border-warning/30 bg-warning/10 text-warning',
                destructive:
                    'border-destructive/30 bg-destructive/10 text-destructive',
                outline: 'border-border bg-transparent text-foreground',
            },
        },
        defaultVariants: { variant: 'neutral' },
    }
)

function Badge({
    className,
    variant = 'neutral',
    render,
    ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
    return useRender({
        defaultTagName: 'span',
        props: mergeProps<'span'>(
            { className: cn(badgeVariants({ variant }), className) },
            props
        ),
        render,
        state: { slot: 'badge', variant },
    })
}

export { Badge, badgeVariants }
