'use client'

import { MapPinIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import type { MediaLite } from '~/lib/compose'

import { MentionSuggestionList, useMentionSuggestions, useSaveLookupHit } from './mention-suggestions'

/** Platforms that keep mention contacts (the tag popover suggests from the same list). */
export type TagPlatform = 'x' | 'threads' | 'instagram' | 'linkedin' | 'facebook'

export const isTagPlatform = (platform: string): platform is TagPlatform =>
    ['x', 'threads', 'instagram', 'linkedin', 'facebook'].includes(platform)

const clean = (value: string) => value.trim().replace(/^@/, '')

/**
 * Username field with the shared mention suggestion popover (same contacts and list as the caption
 * @mention editor), the Instagram exact-username lookup, and "Use @name" as the last option, so a
 * tag never depends on suggestions. Enter adds whatever was typed.
 */
export function UsernamePicker({
    platform,
    onPick,
    exclude = [],
    disabled = false,
    pending = false,
    placeholder = 'Username',
    label,
    autoFocus = false,
    socialConnectionId,
}: {
    platform: TagPlatform
    onPick: (username: string) => void
    /** Usernames already chosen (hidden from the suggestions). */
    exclude?: string[]
    disabled?: boolean
    /** A lookup for the last pick is running. */
    pending?: boolean
    placeholder?: string
    label: string
    autoFocus?: boolean
    /** The card's connection (Instagram exact-username lookup runs through it). */
    socialConnectionId?: string
}) {
    const [text, setText] = useState('')
    const [open, setOpen] = useState(false)
    const { contacts, hit, typed } = useMentionSuggestions({ platform, query: text, enabled: open && !disabled, exclude, socialConnectionId })
    const saveHit = useSaveLookupHit(platform)
    const withHandle = contacts.filter((c) => c.handle)

    const pick = (username: string) => {
        const value = clean(username)
        if (!value) return
        onPick(value)
        setText('')
    }

    return (
        <div className="relative">
            <div className="flex items-center gap-2">
                <Input
                    size="sm"
                    aria-label={label}
                    aria-autocomplete="list"
                    aria-expanded={open}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    placeholder={placeholder}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onFocus={() => setOpen(true)}
                    onBlur={() => window.setTimeout(() => setOpen(false), 120)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            pick(text)
                        } else if (e.key === 'Escape') setOpen(false)
                    }}
                />
                {pending ? <Spinner /> : null}
            </div>
            {open && !disabled ? (
                <MentionSuggestionList
                    contacts={withHandle}
                    hit={hit}
                    last={typed && !withHandle.some((c) => c.handle?.toLowerCase() === typed.toLowerCase()) ? { label: `Use @${typed}`, onSelect: () => pick(typed) } : null}
                    onContact={(contact) => pick(contact.handle!)}
                    onHit={(found) => {
                        // Saved on selection so it is suggested next time; the tag never waits for it.
                        void saveHit.save(found).catch(() => undefined)
                        pick(found.username)
                    }}
                />
            ) : null}
        </div>
    )
}

/** Chip list of usernames (tags on a video, collaborators, X tags). */
export function TagList({
    platform,
    label,
    helper,
    usernames,
    max,
    onAdd,
    onRemove,
    failed = {},
    onDismissFailed,
    pending = false,
    error,
    socialConnectionId,
}: {
    platform: TagPlatform
    socialConnectionId?: string
    label: string
    helper?: string
    usernames: string[]
    max: number
    onAdd: (username: string) => void
    onRemove: (username: string) => void
    /** Usernames that couldn't be used (e.g. the account doesn't exist) → why. */
    failed?: Record<string, string>
    onDismissFailed?: (username: string) => void
    pending?: boolean
    error?: string
}) {
    const full = usernames.length >= max
    return (
        <FormField label={label} helper={helper} error={error}>
            {() => (
                <div className="flex flex-col gap-2">
                    {usernames.length || Object.keys(failed).length ? (
                        <ul className="flex flex-wrap gap-2" aria-label={label}>
                            {usernames.map((username) => (
                                <li key={username}>
                                    <Badge variant="primary">
                                        @{username}
                                        <button type="button" aria-label={`Remove @${username}`} onClick={() => onRemove(username)}>
                                            <XIcon aria-hidden className="size-3" />
                                        </button>
                                    </Badge>
                                </li>
                            ))}
                            {Object.entries(failed).map(([username, reason]) => (
                                <li key={`failed-${username}`}>
                                    <Badge variant="destructive">
                                        @{username}: {reason}
                                        <button type="button" aria-label={`Dismiss @${username}`} onClick={() => onDismissFailed?.(username)}>
                                            <XIcon aria-hidden className="size-3" />
                                        </button>
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <UsernamePicker
                                platform={platform}
                                socialConnectionId={socialConnectionId}
                                label={`Add to ${label}`}
                                exclude={usernames}
                                disabled={full}
                                pending={pending}
                                placeholder={full ? `Limit reached (${max})` : 'Type a username, then Enter'}
                                onPick={(username) => {
                                    if (!usernames.some((u) => u.toLowerCase() === username.toLowerCase())) onAdd(username)
                                }}
                            />
                        </div>
                        <span className="text-mono text-muted-foreground">
                            {usernames.length}/{max}
                        </span>
                    </div>
                </div>
            )}
        </FormField>
    )
}

export type PositionedTag = { username: string; x: number; y: number }

const round4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000

/**
 * "Tag people" on one photo: click the photo to drop a point, choose a username, then drag the
 * pin to move it. x is measured from the left and y from the top, both 0–1.
 */
export function PositionedTagger({
    platform,
    photo,
    title,
    tags,
    max,
    onChange,
    socialConnectionId,
}: {
    platform: TagPlatform
    socialConnectionId?: string
    photo: MediaLite
    title: string
    tags: PositionedTag[]
    max: number
    onChange: (tags: PositionedTag[]) => void
}) {
    const frame = useRef<HTMLDivElement>(null)
    const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
    const [dragging, setDragging] = useState<string | null>(null)
    const full = tags.length >= max

    const locate = (clientX: number, clientY: number) => {
        const box = frame.current?.getBoundingClientRect()
        if (!box || !box.width || !box.height) return null
        return { x: round4((clientX - box.left) / box.width), y: round4((clientY - box.top) / box.height) }
    }
    const percent = (n: number) => `${n * 100}%`

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="text-label text-foreground">{title}</span>
                <Badge variant={tags.length ? 'primary' : 'neutral'}>
                    <MapPinIcon aria-hidden />
                    {tags.length}/{max}
                </Badge>
            </div>
            <div
                ref={frame}
                className="relative w-full max-w-sm cursor-crosshair overflow-hidden rounded-control border border-border"
                onClick={(e) => {
                    if (full || dragging) return
                    setPoint(locate(e.clientX, e.clientY))
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL; shown uncropped so positions match the photo */}
                <img src={photo.url ?? photo.thumbUrl ?? ''} alt={photo.name} className="block w-full select-none" draggable={false} />
                {tags.map((tag) => (
                    <button
                        key={tag.username}
                        type="button"
                        aria-label={`@${tag.username}: drag to move`}
                        style={{ left: percent(tag.x), top: percent(tag.y) }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-control bg-popover px-1 text-mono text-foreground shadow-float ring-1 ring-foreground/5"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId)
                            setDragging(tag.username)
                        }}
                        onPointerMove={(e) => {
                            if (dragging !== tag.username) return
                            const next = locate(e.clientX, e.clientY)
                            if (next) onChange(tags.map((t) => (t.username === tag.username ? { ...t, ...next } : t)))
                        }}
                        onPointerUp={(e) => {
                            e.currentTarget.releasePointerCapture(e.pointerId)
                            // Let the click that ends the drag pass before clicks drop points again.
                            window.setTimeout(() => setDragging(null), 0)
                        }}
                    >
                        @{tag.username}
                    </button>
                ))}
                {point ? (
                    <span
                        aria-hidden
                        style={{ left: percent(point.x), top: percent(point.y) }}
                        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
                    />
                ) : null}
            </div>
            {point ? (
                <div className="flex max-w-sm items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <UsernamePicker
                            platform={platform}
                            socialConnectionId={socialConnectionId}
                            label={`Who is at this point on ${title}?`}
                            placeholder="Who is here? Type a username, then Enter"
                            exclude={tags.map((t) => t.username)}
                            autoFocus
                            onPick={(username) => {
                                if (!tags.some((t) => t.username.toLowerCase() === username.toLowerCase())) {
                                    onChange([...tags, { username, x: point.x, y: point.y }])
                                }
                                setPoint(null)
                            }}
                        />
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setPoint(null)}>
                        Cancel
                    </Button>
                </div>
            ) : (
                <p className="text-meta">{full ? `Limit reached (${max} tags).` : 'Click the photo to tag someone. Drag a tag to move it.'}</p>
            )}
            {tags.length ? (
                <ul className="flex flex-wrap gap-2" aria-label={`People tagged on ${title}`}>
                    {tags.map((tag) => (
                        <li key={tag.username}>
                            <Badge variant="primary">
                                @{tag.username}
                                <button type="button" aria-label={`Remove @${tag.username}`} onClick={() => onChange(tags.filter((t) => t.username !== tag.username))}>
                                    <XIcon aria-hidden className="size-3" />
                                </button>
                            </Badge>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}
