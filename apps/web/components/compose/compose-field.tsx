'use client'

import { SparklesIcon, Undo2Icon } from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import { xWeight, type ComposeField } from '~/lib/compose'
import { trpc } from '~/trpc/client'

const NONE = '__none__'

function OptionSelect({
    id,
    value,
    options,
    required,
    loading,
    onChange,
    describedBy,
}: {
    id: string
    value: string | undefined
    options: { value: string; label: string }[]
    required: boolean
    loading?: boolean
    onChange: (value: string | undefined) => void
    describedBy?: string
}) {
    return (
        <Select<string>
            value={value ?? (required ? null : NONE)}
            onValueChange={(next) => onChange(!next || next === NONE ? undefined : next)}
        >
            <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
                <SelectValue placeholder={loading ? 'Loading…' : 'Choose…'}>
                    {(v: string) => (v === NONE ? 'None' : (options.find((o) => o.value === v)?.label ?? v))}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {required ? null : <SelectItem value={NONE}>None</SelectItem>}
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    )
}

export type FieldAi = {
    /** A JSON/subtitle source is selected. */
    enabled: boolean
    /** A generation is running (button shows a spinner, width unchanged). */
    busy: boolean
    /** The current value is the one AI wrote. */
    filled: boolean
    issue?: string
    onGenerate: () => void
    onUndo: () => void
}

function AiButton({ ai, label }: { ai: FieldAi; label: string }) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Generate ${label} with AI`}
                        disabled={ai.busy}
                        aria-busy={ai.busy || undefined}
                        onClick={ai.onGenerate}
                    />
                }
            >
                {ai.busy ? <Spinner /> : <SparklesIcon aria-hidden />}
            </TooltipTrigger>
            <TooltipContent>Generate with AI</TooltipContent>
        </Tooltip>
    )
}

function AiNotes({ ai }: { ai: FieldAi }) {
    if (!ai.filled && !ai.issue) return null
    return (
        <div className="flex flex-wrap items-center gap-2">
            {ai.filled ? (
                <>
                    <Badge variant="primary">
                        <SparklesIcon aria-hidden />
                        AI
                    </Badge>
                    <Button variant="ghost" size="sm" leftIcon={<Undo2Icon aria-hidden />} onClick={ai.onUndo}>
                        Undo
                    </Button>
                </>
            ) : null}
            {ai.issue ? <span className="text-meta text-warning">{ai.issue}</span> : null}
        </div>
    )
}

/** One compose field, rendered from the platform's capability descriptor. */
export function ComposeFieldControl({
    field,
    value,
    error,
    socialConnectionId,
    onChange,
    ai,
}: {
    field: ComposeField
    value: unknown
    error?: string
    socialConnectionId: string
    onChange: (value: unknown) => void
    /** Only for fields marked ai in the capabilities. */
    ai?: FieldAi
}) {
    const showAi = Boolean(field.ai && ai?.enabled)
    const playlists = trpc.platforms.youtubePlaylists.useQuery(
        { socialConnectionId },
        { enabled: field.kind === 'playlist', staleTime: 5 * 60 * 1000, retry: false }
    )
    const categories = trpc.platforms.youtubeCategories.useQuery(
        { socialConnectionId },
        { enabled: field.optionsSource === 'youtube.categories', staleTime: 60 * 60 * 1000, retry: false }
    )

    const text = typeof value === 'string' ? value : ''
    const counter =
        field.maxLength && (field.kind === 'text' || field.kind === 'textarea')
            ? {
                  value: text,
                  limit: field.maxLength,
                  mode: field.countMode ?? 'chars',
                  ...(field.countMode === 'weighted' ? { weigh: xWeight } : {}),
              }
            : field.kind === 'tags' && field.maxLength
              ? { value: Array.isArray(value) ? value.join(',') : '', limit: field.maxLength }
              : undefined

    if (field.kind === 'toggle') {
        const checked = typeof value === 'boolean' ? value : field.defaultValue === true
        return (
            <div className="flex items-center justify-between gap-4">
                <label className="text-label text-foreground" htmlFor={`${socialConnectionId}-${field.name}`}>
                    {field.label}
                </label>
                <Switch
                    id={`${socialConnectionId}-${field.name}`}
                    checked={checked}
                    onCheckedChange={(next) => onChange(next)}
                />
            </div>
        )
    }

    const control = (
        <FormField label={field.label} required={field.required} error={error} helper={field.helper} counter={counter}>
            {(p) => {
                switch (field.kind) {
                    case 'textarea':
                        return (
                            <Textarea
                                {...p}
                                className={showAi ? 'pe-12' : undefined}
                                value={text}
                                onChange={(e) => onChange(e.target.value || undefined)}
                            />
                        )
                    case 'tags':
                        return (
                            <Input
                                {...p}
                                // Re-mount when AI (or Undo) replaces the tags.
                                key={Array.isArray(value) ? value.join('|') : ''}
                                className={showAi ? 'pe-12' : undefined}
                                placeholder="Comma-separated, e.g. graphql, api"
                                defaultValue={Array.isArray(value) ? value.join(', ') : ''}
                                onBlur={(e) => {
                                    const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean)
                                    onChange(tags.length ? tags : undefined)
                                }}
                            />
                        )
                    case 'select': {
                        const options =
                            field.optionsSource === 'youtube.categories'
                                ? (categories.data ?? []).map((c) => ({ value: c.id, label: c.title }))
                                : (field.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))
                        return (
                            <OptionSelect
                                id={p.id}
                                describedBy={p['aria-describedby']}
                                value={typeof value === 'string' ? value : undefined}
                                options={options}
                                required={field.required}
                                loading={categories.isLoading}
                                onChange={onChange}
                            />
                        )
                    }
                    case 'playlist':
                        return (
                            <OptionSelect
                                id={p.id}
                                describedBy={p['aria-describedby']}
                                value={typeof value === 'string' ? value : undefined}
                                options={(playlists.data ?? []).map((pl) => ({ value: pl.id, label: pl.title }))}
                                required={false}
                                loading={playlists.isLoading}
                                onChange={onChange}
                            />
                        )
                    case 'radio':
                        return (
                            <RadioGroup
                                {...p}
                                value={typeof value === 'boolean' || typeof value === 'string' ? String(value) : ''}
                                onValueChange={(next) => {
                                    const option = field.options?.find((o) => String(o.value) === next)
                                    onChange(option?.value)
                                }}
                            >
                                {(field.options ?? []).map((option) => (
                                    <label key={String(option.value)} className="flex items-center gap-2 text-foreground">
                                        <RadioGroupItem value={String(option.value)} />
                                        {option.label}
                                    </label>
                                ))}
                            </RadioGroup>
                        )
                    default:
                        return (
                            <Input
                                {...p}
                                className={showAi ? 'pe-12' : undefined}
                                value={text}
                                onChange={(e) => onChange(e.target.value || undefined)}
                            />
                        )
                }
            }}
        </FormField>
    )

    if (!showAi || !ai) return control
    return (
        <div className="flex flex-col gap-2">
            {/* The sparkle sits in the field's top-right corner, over the control. */}
            <div className="relative">
                {control}
                <span className="absolute top-8 end-1">
                    <AiButton ai={ai} label={field.label} />
                </span>
            </div>
            <AiNotes ai={ai} />
        </div>
    )
}
