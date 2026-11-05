import { cn } from '~/lib/utils'

/**
 * Fannout logo mark — placeholder: one dot fanning out into three lines.
 * Dot uses the primary colour; lines inherit currentColor.
 */
export function LogoMark({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className={cn('size-6 shrink-0', className)}
        >
            <circle cx="5" cy="12" r="3" className="fill-primary" />
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 10.5 20 4" />
                <path d="M9.5 12H21" />
                <path d="M9 13.5 20 20" />
            </g>
        </svg>
    )
}

/** Logo mark + "Fannout" wordmark. */
export function Logo({
    className,
    compact = false,
}: {
    className?: string
    /** Hide the wordmark below the sm breakpoint. */
    compact?: boolean
}) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-2 text-foreground',
                className
            )}
        >
            <LogoMark />
            <span
                translate="no"
                className={cn(
                    'text-base font-semibold tracking-tight',
                    compact && 'hidden sm:inline'
                )}
            >
                Fannout
            </span>
        </span>
    )
}
