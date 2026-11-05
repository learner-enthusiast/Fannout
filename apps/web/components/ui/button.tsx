import * as React from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2Icon } from 'lucide-react'

import { cn } from '~/lib/utils'

/**
 * Button — every clickable action. See DESIGN.md §4.4.
 *
 * - Default is `secondary` / `md`. `primary` must be chosen explicitly and
 *   used for ONE action per screen/section.
 * - `loading` swaps the leading icon for a spinner without changing width.
 * - Icon-only (`size="icon*"`) buttons need `aria-label` + a Tooltip.
 * - Never pass colour / radius / height / font-size classes — pick a variant.
 */
const buttonVariants = cva(
    [
        'group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control border border-transparent font-medium whitespace-nowrap select-none',
        'transition-[color,background-color,border-color,transform] duration-fast ease-out',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        // data-force="hover|focus" pins a state for /theme-preview only
        'data-[force=focus]:ring-2 data-[force=focus]:ring-ring data-[force=focus]:ring-offset-2 data-[force=focus]:ring-offset-background',
        'active:not-aria-[haspopup]:translate-y-px motion-reduce:active:translate-y-0',
        'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    ],
    {
        variants: {
            variant: {
                primary:
                    'bg-primary text-primary-foreground hover:bg-primary-hover data-[force=hover]:bg-primary-hover',
                secondary:
                    'border-border bg-card text-foreground hover:bg-popover aria-expanded:bg-popover data-[force=hover]:bg-popover',
                // dark: --muted equals --card, so step to popover to stay visible on cards
                ghost: 'text-foreground hover:bg-muted aria-expanded:bg-muted data-[force=hover]:bg-muted dark:hover:bg-popover dark:aria-expanded:bg-popover dark:data-[force=hover]:bg-popover',
                destructive:
                    'bg-destructive text-destructive-foreground hover:bg-destructive/90 data-[force=hover]:bg-destructive/90',
                link: 'h-auto! border-0 px-0! text-link underline-offset-4 hover:underline data-[force=hover]:underline',
            },
            size: {
                sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
                md: 'h-10 px-4 text-sm [&_svg]:size-4',
                lg: 'h-12 px-5 text-base [&_svg]:size-4.5',
                icon: 'size-10 [&_svg]:size-4',
                'icon-sm': 'size-8 [&_svg]:size-3.5',
                'icon-lg': 'size-12 [&_svg]:size-4.5',
            },
        },
        defaultVariants: {
            variant: 'secondary',
            size: 'md',
        },
    }
)

type ButtonProps = ButtonPrimitive.Props &
    VariantProps<typeof buttonVariants> & {
        /** Shows a spinner in place of the leading icon, disables the button. */
        loading?: boolean
        /** One leading 16px lucide icon (rendered as an element). */
        leftIcon?: React.ReactNode
    }

function Button({
    className,
    variant = 'secondary',
    size = 'md',
    loading = false,
    leftIcon,
    disabled,
    children,
    ...props
}: ButtonProps) {
    const isIconOnly = size?.startsWith('icon')
    const spinner = (
        <Loader2Icon aria-hidden className="animate-spin" data-icon="spinner" />
    )

    let content: React.ReactNode
    if (isIconOnly) {
        // Spinner overlays the icon so the square never resizes.
        content = loading ? spinner : children
    } else if (leftIcon) {
        content = (
            <>
                {loading ? spinner : leftIcon}
                {children}
            </>
        )
    } else if (loading) {
        // No leading icon to swap: overlay the spinner, keep the label in
        // the layout (invisible) so the width does not change.
        content = (
            <>
                <span className="inline-flex items-center gap-2 opacity-0">
                    {children}
                </span>
                <span className="absolute inset-0 inline-flex items-center justify-center">
                    {spinner}
                </span>
            </>
        )
    } else {
        content = children
    }

    return (
        <ButtonPrimitive
            data-slot="button"
            data-variant={variant}
            data-size={size}
            className={cn(buttonVariants({ variant, size }), className)}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            aria-disabled={disabled || loading || undefined}
            focusableWhenDisabled={loading}
            {...props}
        >
            {content}
        </ButtonPrimitive>
    )
}

export { Button, buttonVariants, type ButtonProps }
