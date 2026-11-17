'use client'

import { PlusIcon } from 'lucide-react'

import { keepPreviousData } from '@tanstack/react-query'
import type { RouterOutputs } from '@repo/trpc/client'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Command, CommandGroup, CommandItem, CommandList } from '~/components/ui/command'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { trpc } from '~/trpc/client'

export type MentionContact = RouterOutputs['mentions']['search']['items'][number]
export type MentionPlatform = MentionContact['platform']
export type LookupHit = RouterOutputs['mentions']['lookupInstagram']

const INSTAGRAM_HANDLE = /^[A-Za-z0-9_.]{2,30}$/
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * One suggestion source for every mention/tag input: saved mention_contacts (prefix match, most
 * used first, 10 per page; empty query = most used/recent). On Instagram, a full username that isn't a
 * contact yet is also looked up (Business Discovery, server-side, 400 ms debounce, cached 24 h);
 * any failure just leaves "Use @typed".
 */
export function useMentionSuggestions({
    platform,
    query,
    enabled,
    exclude = [],
    socialConnectionId,
}: {
    platform: MentionPlatform
    query: string
    enabled: boolean
    /** Handles already chosen (hidden). */
    exclude?: string[]
    /** Instagram connection the exact-username lookup runs through; absent = no lookup. */
    socialConnectionId?: string
}) {
    const q = query.trim().replace(/^@/, '')
    const debounced = useDebouncedValue(q, 150)
    const search = trpc.mentions.search.useQuery({ platform, q: debounced, limit: 10 }, { enabled, staleTime: 0, placeholderData: keepPreviousData })
    const taken = new Set(exclude.map((u) => u.toLowerCase()))
    const contacts = (search.data?.items ?? []).filter((c) => !(c.handle && taken.has(c.handle.toLowerCase())))

    // Never per keystroke: only once the text has been stable for 400 ms and the contact search for it is in.
    const settled = useDebouncedValue(q, 400)
    const known = (search.data?.items ?? []).some((c) => c.handle?.toLowerCase() === settled.toLowerCase()) || taken.has(settled.toLowerCase())
    const canLookup =
        enabled &&
        platform === 'instagram' &&
        Boolean(socialConnectionId) &&
        settled === q &&
        INSTAGRAM_HANDLE.test(settled) &&
        debounced === settled &&
        !search.isPlaceholderData &&
        !search.isFetching &&
        !known
    const lookup = trpc.mentions.lookupInstagram.useQuery(
        { socialConnectionId: socialConnectionId ?? '', username: settled },
        { enabled: canLookup, staleTime: DAY_MS, gcTime: DAY_MS, retry: false }
    )
    const hit = canLookup && lookup.data?.found ? lookup.data : null
    return { contacts, hit, typed: q }
}

/** Saves a looked-up profile as a contact (best effort) so it is suggested next time. */
export function useSaveLookupHit(platform: MentionPlatform) {
    const utils = trpc.useUtils()
    const create = trpc.mentions.create.useMutation({ onSettled: () => void utils.mentions.search.invalidate() })
    return {
        save: (hit: LookupHit) => create.mutateAsync({ platform, handle: hit.username, displayName: hit.displayName ?? hit.username, ...(hit.avatarUrl ? { avatarUrl: hit.avatarUrl } : {}) }),
        pending: create.isPending,
    }
}

function ContactRow({ name, handle, avatarUrl }: { name: string; handle: string | null; avatarUrl: string | null }) {
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar size="sm">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{name}</span>
                {handle ? <span className="truncate text-meta">{handle}</span> : null}
            </span>
        </span>
    )
}

/**
 * The suggestion popover body shared by the caption @mention editor and every tag/collaborator
 * picker: contacts, then the looked-up profile, then the last option (always present when given).
 * `selected` (index over all rows) is for inputs that drive the keyboard themselves.
 */
export function MentionSuggestionList({
    id,
    contacts,
    hit,
    last,
    selected,
    onContact,
    onHit,
}: {
    id?: string
    contacts: MentionContact[]
    hit: LookupHit | null
    /** e.g. "Use @name" or "Add … as new contact". */
    last: { label: string; onSelect: () => void } | null
    selected?: number
    onContact: (contact: MentionContact) => void
    onHit: (hit: LookupHit) => void
}) {
    if (!contacts.length && !hit && !last) return null
    const hold = (e: React.MouseEvent) => e.preventDefault()
    return (
        <div className="absolute top-full z-50 mt-1 w-full rounded-surface bg-popover shadow-float ring-1 ring-foreground/5">
            <Command shouldFilter={false} className="rounded-surface" {...(selected !== undefined ? { value: String(selected) } : {})}>
                <CommandList id={id}>
                    <CommandGroup heading="Mention contacts">
                        {contacts.map((contact, index) => (
                            <CommandItem key={contact.id} value={String(index)} onMouseDown={hold} onSelect={() => onContact(contact)} className="rounded-control">
                                <ContactRow name={contact.displayName} handle={contact.handle ? `@${contact.handle}` : contact.platformRef} avatarUrl={contact.avatarUrl} />
                            </CommandItem>
                        ))}
                        {hit ? (
                            <CommandItem value={String(contacts.length)} onMouseDown={hold} onSelect={() => onHit(hit)} className="rounded-control">
                                <ContactRow name={hit.displayName ?? hit.username} handle={`@${hit.username} · on Instagram`} avatarUrl={hit.avatarUrl} />
                            </CommandItem>
                        ) : null}
                        {last ? (
                            <CommandItem value={String(contacts.length + (hit ? 1 : 0))} onMouseDown={hold} onSelect={last.onSelect} className="rounded-control">
                                <PlusIcon aria-hidden /> {last.label}
                            </CommandItem>
                        ) : null}
                    </CommandGroup>
                </CommandList>
            </Command>
        </div>
    )
}
