import { cn } from '~/lib/utils'

/**
 * Skeleton — loading placeholder shaped like the final content. Never use a
 * full-page spinner. Uses the border tone so it is visible on both
 * bg-background and bg-card in both themes.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="skeleton"
            aria-hidden
            className={cn(
                'animate-pulse rounded-control bg-border motion-reduce:animate-none',
                className
            )}
            {...props}
        />
    )
}

export { Skeleton }
