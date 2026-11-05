import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge must know our custom tokens (globals.css @theme), otherwise
 * e.g. `text-section-title text-foreground` is treated as two colours and
 * the size gets dropped.
 */
const twMerge = extendTailwindMerge<'duration-token'>({
    extend: {
        theme: {
            text: [
                'page-title',
                'section-title',
                'body',
                'meta',
                'label',
                'mono',
            ],
            radius: ['control', 'surface'],
            shadow: ['float'],
            color: [
                'primary-hover',
                'link',
                'success',
                'success-foreground',
                'warning',
                'warning-foreground',
                'destructive-foreground',
            ],
            container: ['page', 'form'],
        },
        classGroups: {
            'duration-token': ['duration-fast', 'duration-base'],
        },
    },
})

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
