'use client'

import { MessageSquareTextIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '~/components/ui/popover'
import { Textarea } from '~/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { trpc } from '~/trpc/client'

export function InstructionControl({
    value,
    onChange,
    label,
}: {
    value: string
    onChange: (value: string) => void
    label: string
}) {
    const utils = trpc.useUtils()
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const presets = trpc.ai.instructionPresets.useQuery({ limit: 10 }, { enabled: open, staleTime: 0 })
    const create = trpc.ai.createInstructionPreset.useMutation({
        onSuccess: () => {
            setName('')
            void utils.ai.instructionPresets.invalidate()
        },
    })

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger render={
                    <PopoverTrigger render={
                        <Button variant="ghost" size="icon-sm" aria-label={label} className="relative" />
                    } />
                }>
                    <MessageSquareTextIcon aria-hidden />
                    {value.trim() ? <span className="absolute top-1 end-1 size-2 rounded-full bg-primary"><span className="sr-only">Instructions set</span></span> : null}
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-96 gap-4">
                <PopoverHeader>
                    <PopoverTitle>{label}</PopoverTitle>
                    <PopoverDescription>Guide wording and style. Instructions never override source facts or platform limits.</PopoverDescription>
                </PopoverHeader>
                <label className="flex flex-col gap-2">
                    <span className="text-label">Instructions</span>
                    <Textarea
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        maxLength={500}
                        placeholder="e.g. Start every title with ‘Interview Series #10 – ’"
                        aria-label={label}
                    />
                    <span className="text-meta">{value.length}/500 · saved in this draft</span>
                </label>
                {presets.data?.items.length ? (
                    <div className="flex flex-col gap-2">
                        <span className="text-label">Recent presets</span>
                        <div className="flex max-h-32 flex-col overflow-y-auto">
                            {presets.data.items.map((preset) => (
                                <Button key={preset.id} variant="ghost" size="sm" className="justify-start" onClick={() => onChange(preset.text)}>
                                    {preset.name}
                                </Button>
                            ))}
                        </div>
                    </div>
                ) : null}
                <form className="flex gap-2" onSubmit={(event) => {
                    event.preventDefault()
                    create.mutate({ name: name.trim(), text: value.trim() })
                }}>
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Preset name" maxLength={100} aria-label="Preset name" />
                    <Button type="submit" size="sm" loading={create.isPending} disabled={!name.trim() || !value.trim()}>Save Preset</Button>
                </form>
                {create.error ? <p className="text-destructive text-meta">{create.error.message}</p> : null}
            </PopoverContent>
        </Popover>
    )
}
