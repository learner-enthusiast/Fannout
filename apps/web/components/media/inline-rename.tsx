'use client'

import { CheckIcon, PencilIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import { trpc } from '~/trpc/client'

/** Media name with an edit button; Enter saves, Escape cancels. */
export function InlineRename({
    mediaId,
    name,
    className,
}: {
    mediaId: string
    name: string
    className?: string
}) {
    const utils = trpc.useUtils()
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState(name)
    const rename = trpc.media.rename.useMutation({
        onSuccess: () => {
            setEditing(false)
            void utils.media.list.invalidate()
            void utils.media.get.invalidate({ mediaId })
            void utils.folders.get.invalidate()
            toast.success('Renamed')
        },
    })

    const save = () => {
        const next = value.trim()
        if (!next || next === name) return setEditing(false)
        rename.mutate({ mediaId, name: next })
    }

    if (!editing) {
        return (
            <div className={`flex min-w-0 items-center gap-1 ${className ?? ''}`}>
                <span className="min-w-0 truncate text-label text-foreground">{name}</span>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Rename ${name}`}
                                onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setValue(name)
                                    setEditing(true)
                                }}
                            />
                        }
                    >
                        <PencilIcon aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent>Rename</TooltipContent>
                </Tooltip>
            </div>
        )
    }

    return (
        <form
            className={`flex min-w-0 items-center gap-1 ${className ?? ''}`}
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
                event.preventDefault()
                save()
            }}
        >
            <Input
                size="sm"
                autoFocus
                aria-label="Name"
                value={value}
                maxLength={200}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
            />
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Save name" loading={rename.isPending}>
                <CheckIcon aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel rename" onClick={() => setEditing(false)}>
                <XIcon aria-hidden />
            </Button>
        </form>
    )
}
