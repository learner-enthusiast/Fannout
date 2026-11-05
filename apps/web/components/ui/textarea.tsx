import * as React from 'react'

import { cn } from '~/lib/utils'
import { controlVariants, type ControlSize } from '~/lib/control'

/**
 * Textarea — multi-line text. Render inside `<FormField>` (pairs well with its
 * counter). `size` sets padding/text to match Input; min height is 2× the
 * control height and grows with content.
 */
function Textarea({
    className,
    size = 'md',
    error,
    ...props
}: React.ComponentProps<'textarea'> & {
    size?: ControlSize
    error?: boolean
}) {
    return (
        <textarea
            data-slot="textarea"
            data-size={size}
            aria-invalid={error || props['aria-invalid'] || undefined}
            className={cn(
                controlVariants({ size }),
                'field-sizing-content h-auto resize-none py-2',
                size === 'sm' && 'min-h-16',
                size === 'md' && 'min-h-20',
                size === 'lg' && 'min-h-24 py-3',
                className
            )}
            {...props}
        />
    )
}

export { Textarea }
