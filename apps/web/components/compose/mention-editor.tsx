'use client'

import { PlusIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { keepPreviousData } from '@tanstack/react-query'
import type { RouterOutputs } from '@repo/trpc/client'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '~/components/ui/command'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { trpc } from '~/trpc/client'

type Contact = RouterOutputs['mentions']['search']['items'][number]
type Platform = Contact['platform']

export type MentionRange = {
    contactId: string
    start: number
    length: number
    displayName: string
    handle?: string | null
    platformRef?: string | null
}

function tokenFor(platform: Platform, contact: { displayName: string; handle?: string | null; platformRef?: string | null }) {
    if (platform === 'facebook') return `@${contact.displayName}(${contact.platformRef ?? ''})`
    return platform === 'linkedin' ? `@${contact.displayName}` : `@${contact.handle ?? contact.displayName}`
}

function validRanges(platform: Platform, text: string, ranges: MentionRange[]) {
    let previousEnd = 0
    return [...ranges].sort((a, b) => a.start - b.start).filter((range) => {
        const valid = range.start >= previousEnd && range.start + range.length <= text.length &&
            text.slice(range.start, range.start + range.length) === tokenFor(platform, range)
        if (valid) previousEnd = range.start + range.length
        return valid
    })
}

function reconcile(platform: Platform, before: string, after: string, ranges: MentionRange[]) {
    let prefix = 0
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
    let suffix = 0
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
    const oldEditEnd = before.length - suffix
    const delta = after.length - before.length
    const shifted = ranges.flatMap((range) => {
        if (oldEditEnd <= range.start) return [{ ...range, start: range.start + delta }]
        if (prefix >= range.start + range.length) return [range]
        return []
    })
    return validRanges(platform, after, shifted)
}

export function MentionTextarea({
    platform,
    value,
    onChange,
    mentions,
    onMentionsChange,
    ...props
}: Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
    platform: Platform
    value: string
    onChange: (value: string) => void
    mentions: MentionRange[]
    onMentionsChange: (ranges: MentionRange[]) => void
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const utils = trpc.useUtils()
    const [active, setActive] = useState<{ start: number; end: number; query: string } | null>(null)
    const [selected, setSelected] = useState(0)
    const [adding, setAdding] = useState(false)
    const [newName, setNewName] = useState('')
    const [newTarget, setNewTarget] = useState('')
    const query = useDebouncedValue(active?.query ?? '', 150)
    const search = trpc.mentions.search.useQuery(
        { platform, q: query, limit: 10 },
        { enabled: Boolean(active) && !adding, staleTime: 0, placeholderData: keepPreviousData },
    )
    const contacts = useMemo(() => search.data?.items ?? [], [search.data])
    const create = trpc.mentions.create.useMutation({
        onSuccess: (contact) => {
            if (active) insert(contact)
            setAdding(false)
            setNewTarget('')
            void utils.mentions.search.invalidate()
        },
    })

    function detect(next: string, caret: number) {
        const match = /(?:^|\s)@([\p{L}\p{N}_. -]{0,60})$/u.exec(next.slice(0, caret))
        if (!match) {
            setActive(null)
            return
        }
        const mentionQuery = match[1] ?? ''
        setActive({ start: caret - mentionQuery.length - 1, end: caret, query: mentionQuery })
        setSelected(0)
    }

    function insert(contact: Contact) {
        if (!active) return
        const token = tokenFor(platform, contact)
        const next = `${value.slice(0, active.start)}${token} ${value.slice(active.end)}`
        const range: MentionRange = {
            contactId: contact.id, start: active.start, length: token.length,
            displayName: contact.displayName, handle: contact.handle, platformRef: contact.platformRef,
        }
        onChange(next)
        onMentionsChange(validRanges(platform, next, [...mentions, range]))
        const caret = active.start + token.length + 1
        setActive(null)
        requestAnimationFrame(() => {
            textareaRef.current?.focus()
            textareaRef.current?.setSelectionRange(caret, caret)
        })
    }

    const targetLabel = platform === 'linkedin' ? 'LinkedIn URN' : platform === 'facebook' ? 'Facebook Page ID' : 'Handle'
    const targetHelp = platform === 'linkedin'
        ? 'Use urn:li:person:{id} or urn:li:organization:{id}. The display name must match LinkedIn exactly.'
        : platform === 'facebook'
          ? 'Use the numeric Page ID. Facebook will show this as text, not a tag.'
          : 'Username without @; letters, numbers, underscores and periods.'

    return (
        <div className="relative flex flex-col gap-2">
            <Textarea
                {...props}
                ref={textareaRef}
                value={value}
                aria-autocomplete="list"
                aria-expanded={Boolean(active)}
                aria-controls={active ? 'mention-options' : undefined}
                onChange={(event) => {
                    const next = event.target.value
                    onMentionsChange(reconcile(platform, value, next, mentions))
                    onChange(next)
                    detect(next, event.target.selectionStart)
                }}
                onKeyDown={(event) => {
                    if (!active) return
                    const count = contacts.length + 1
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        setSelected((current) => (current + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
                    } else if (event.key === 'Enter') {
                        event.preventDefault()
                        if (selected < contacts.length) insert(contacts[selected]!)
                        else { setNewName(active.query); setAdding(true) }
                    } else if (event.key === 'Escape') {
                        event.preventDefault()
                        setActive(null)
                        setAdding(false)
                    }
                }}
                onBlur={() => window.setTimeout(() => { setActive(null); setAdding(false) }, 120)}
            />
            {mentions.length ? (
                <div className="flex flex-wrap gap-2" aria-label="Mentions in this post">
                    {mentions.map((range) => <Badge key={`${range.contactId}-${range.start}`} variant="primary">{tokenFor(platform, range)}</Badge>)}
                </div>
            ) : null}
            {platform === 'facebook' && mentions.length ? <p className="text-warning text-meta">Facebook will show this as text, not a tag.</p> : null}
            {active ? (
                <div className="absolute top-full z-50 mt-1 w-full rounded-surface bg-popover shadow-float ring-1 ring-foreground/5">
                    {adding ? (
                        <form className="flex flex-col gap-2 p-2" onSubmit={(event) => {
                            event.preventDefault()
                            onMentionsChange(reconcile(platform, value, textareaRef.current?.value ?? value, mentions))
                            create.mutate({
                                platform, displayName: newName.trim(),
                                ...(platform === 'linkedin' || platform === 'facebook' ? { platformRef: newTarget.trim() } : { handle: newTarget.trim().replace(/^@/, '') }),
                            })
                        }}>
                            <Input aria-label="Display name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Exact display name" required maxLength={200} />
                            <Input aria-label={targetLabel} value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder={targetLabel} required />
                            <p className="text-meta">{targetHelp}</p>
                            {create.error ? <p className="text-destructive text-meta">{create.error.message}</p> : null}
                            <Button type="submit" size="sm" loading={create.isPending}>Add Contact</Button>
                        </form>
                    ) : (
                        <Command shouldFilter={false} className="rounded-surface" value={String(selected)}>
                            <CommandList id="mention-options">
                                <CommandGroup heading="Mention contacts">
                                    {contacts.map((contact, index) => (
                                        <CommandItem key={contact.id} value={String(index)} onMouseDown={(e) => e.preventDefault()} onSelect={() => insert(contact)} className="rounded-control">
                                            <span className="flex min-w-0 flex-1 flex-col"><span>{contact.displayName}</span><span className="text-meta">{contact.handle ? `@${contact.handle}` : contact.platformRef}</span></span>
                                        </CommandItem>
                                    ))}
                                    <CommandItem value={String(contacts.length)} onMouseDown={(e) => e.preventDefault()} onSelect={() => { setNewName(active.query); setAdding(true) }} className="rounded-control">
                                        <PlusIcon aria-hidden /> Add “{active.query}” as new contact
                                    </CommandItem>
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    )}
                </div>
            ) : null}
        </div>
    )
}

