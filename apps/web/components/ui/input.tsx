import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '~/lib/utils'
import { controlVariants, type ControlSize } from '~/lib/control'

/**
 * Input — single-line text entry. Render inside `<FormField>` so it gets a
 * label, helper/error text and ids. Heights match Button (sm 32 / md 40 /
 * lg 48). `error` sets aria-invalid; FormField sets it for you.
 */
function Input({
    className,
    type,
    size = 'md',
    error,
    ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
    size?: ControlSize
    error?: boolean
}) {
    return (
        <InputPrimitive
            type={type}
            data-slot="input"
            data-size={size}
            aria-invalid={error || props['aria-invalid'] || undefined}
            className={cn(
                controlVariants({ size }),
                'file:me-3 file:border-0 file:bg-transparent file:font-medium file:text-foreground',
                className
            )}
            {...props}
        />
    )
}

export { Input }
