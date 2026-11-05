import { cva } from 'class-variance-authority'

/**
 * Shared look for text controls (Input, Textarea, Select trigger).
 * Heights match Button sizes exactly — DESIGN.md §4.3 / §4.9.
 */
export const controlVariants = cva(
    [
        'w-full min-w-0 rounded-control border border-input bg-background text-foreground light:bg-popover',
        'transition-[color,border-color,box-shadow] duration-fast ease-out',
        'placeholder:text-muted-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
    ],
    {
        variants: {
            size: {
                sm: 'h-8 px-3 text-xs',
                md: 'h-10 px-4 text-sm',
                lg: 'h-12 px-5 text-base',
            },
        },
        defaultVariants: { size: 'md' },
    }
)

export type ControlSize = 'sm' | 'md' | 'lg'
