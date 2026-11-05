'use client'

import * as React from 'react'
import { CircleAlertIcon } from 'lucide-react'

import { cn } from '~/lib/utils'
import { countText, counterTone, type CounterMode } from '~/lib/counter'
import { Field, FieldLabel } from '~/components/ui/field'

export type FormFieldControlProps = {
    id: string
    'aria-describedby'?: string
    'aria-invalid'?: true
    'aria-required'?: true
    required?: boolean
}

export type FormFieldCounter = {
    value: string
    limit: number
    /** chars = graphemes (default), bytes = UTF-8, weighted = your `weigh` fn */
    mode?: CounterMode
    weigh?: (value: string) => number
}

/**
 * FormField — the ONLY way forms render a field (DESIGN.md §4.9).
 * Label above, control, then helper text — replaced by the error when set —
 * and an optional right-aligned mono counter (warning ≥90%, destructive over).
 * Wires id / aria-describedby / aria-invalid into the control via the render
 * function. Validate on blur + submit, not per keystroke.
 *
 * @example
 * <FormField label="Caption" required helper="Shown under the post."
 *   error={errors.caption} counter={{ value: caption, limit: 280 }}>
 *   {(p) => <Textarea {...p} value={caption} onChange={…} onBlur={validate} />}
 * </FormField>
 */
export function FormField({
    label,
    helper,
    error,
    required,
    counter,
    orientation = 'vertical',
    className,
    children,
}: {
    label: React.ReactNode
    helper?: React.ReactNode
    error?: React.ReactNode
    required?: boolean
    counter?: FormFieldCounter
    orientation?: 'vertical' | 'horizontal'
    className?: string
    children: (props: FormFieldControlProps) => React.ReactNode
}) {
    const id = React.useId()
    const helperId = `${id}-helper`
    const counterId = `${id}-counter`
    const hasError = Boolean(error)
    const message = hasError ? error : helper

    let counterNode: React.ReactNode = null
    if (counter) {
        const count = countText(
            counter.value,
            counter.mode ?? 'chars',
            counter.weigh
        )
        const tone = counterTone(count, counter.limit)
        counterNode = (
            <span
                id={counterId}
                data-tone={tone}
                className={cn(
                    'ms-auto shrink-0 text-mono text-muted-foreground',
                    tone === 'warning' && 'text-warning',
                    tone === 'destructive' && 'text-destructive'
                )}
            >
                <span className="sr-only">
                    {counter.mode === 'bytes'
                        ? 'Bytes used'
                        : 'Characters used'}
                    :{' '}
                </span>
                {count.toLocaleString()} / {counter.limit.toLocaleString()}
            </span>
        )
    }

    const describedBy =
        [message ? helperId : null, counter ? counterId : null]
            .filter(Boolean)
            .join(' ') || undefined

    const control = children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': hasError ? true : undefined,
        'aria-required': required ? true : undefined,
        required,
    })

    const labelNode = (
        <FieldLabel htmlFor={id}>
            {label}
            {required ? (
                <span aria-hidden className="text-destructive">
                    *
                </span>
            ) : null}
        </FieldLabel>
    )

    if (orientation === 'horizontal') {
        return (
            <Field
                orientation="horizontal"
                data-invalid={hasError || undefined}
                className={className}
            >
                <div className="flex flex-1 flex-col gap-1">
                    {labelNode}
                    {message ? (
                        <FieldMessage id={helperId} error={hasError}>
                            {message}
                        </FieldMessage>
                    ) : null}
                </div>
                {control}
            </Field>
        )
    }

    return (
        <Field data-invalid={hasError || undefined} className={className}>
            {labelNode}
            {control}
            {message || counterNode ? (
                <div className="flex items-start gap-4">
                    {message ? (
                        <FieldMessage id={helperId} error={hasError}>
                            {message}
                        </FieldMessage>
                    ) : null}
                    {counterNode}
                </div>
            ) : null}
        </Field>
    )
}

function FieldMessage({
    id,
    error,
    children,
}: {
    id: string
    error: boolean
    children: React.ReactNode
}) {
    if (error) {
        return (
            <p
                id={id}
                role="alert"
                className="flex items-start gap-1 text-meta text-destructive"
            >
                <CircleAlertIcon
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0"
                />
                <span>{children}</span>
            </p>
        )
    }
    return (
        <p id={id} className="text-meta text-muted-foreground">
            {children}
        </p>
    )
}
