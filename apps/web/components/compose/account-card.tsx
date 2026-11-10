'use client'

import { ChevronDownIcon, CircleAlertIcon, CircleCheckIcon, CopyIcon, ImageIcon, InfoIcon } from 'lucide-react'
import { useState } from 'react'

import type { RouterOutputs } from '@repo/trpc/client'
import { providers } from '~/components/connections/providers'
import { MediaPreview } from '~/components/media/media-preview'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { isEmpty, type Capabilities, type ComposeMediaType, type Issue, type MediaLite } from '~/lib/compose'

import { ComposeFieldControl, type FieldAi } from './compose-field'
import { InstructionControl } from './instruction-control'
import type { MentionRange } from './mention-editor'

type Connection = RouterOutputs['socialConnections']['list']['items'][number]

export function accountName(connection: Connection) {
    return connection.displayName ?? (connection.username ? `@${connection.username}` : connection.provider)
}

export function AccountAvatar({ connection }: { connection: Connection }) {
    const provider = providers.find((p) => p.value === connection.provider)
    const Icon = provider?.icon
    return (
        <span className="relative">
            <Avatar>
                {connection.profilePictureUrl ? <AvatarImage src={connection.profilePictureUrl} alt="" /> : null}
                <AvatarFallback>{accountName(connection).slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            {Icon ? (
                <span className="absolute -end-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-popover">
                    <Icon aria-label={provider?.name} className="size-3" />
                </span>
            ) : null}
        </span>
    )
}

/**
 * One account's post settings, generated from the platform's capabilities.
 * Errors come from the server's dry-run validation (the platform's own Zod schema).
 */
export function AccountCard({
    connection,
    capabilities,
    mediaType,
    input,
    issues,
    video,
    thumbnail,
    photos,
    override,
    copySources,
    onChange,
    onPickThumbnail,
    thumbnailInherited = false,
    onResetThumbnail,
    onOverride,
    onCopyFrom,
    aiFor,
    instruction,
    onInstructionChange,
    headerChip,
    scheduleSlot,
}: {
    connection: Connection
    capabilities: Capabilities
    mediaType: ComposeMediaType
    input: Record<string, unknown>
    issues: Issue[]
    video: MediaLite | null
    thumbnail: MediaLite | null
    photos: MediaLite[]
    override: string[] | undefined
    copySources: { id: string; name: string }[]
    onChange: (field: string, value: unknown) => void
    onPickThumbnail: () => void
    /** Showing the shared "all accounts" thumbnail (no pick of its own). */
    thumbnailInherited?: boolean
    /** Drop this card's own thumbnail and go back to the shared one / platform default. */
    onResetThumbnail?: () => void
    onOverride: (ids: string[] | undefined) => void
    onCopyFrom: (sourceId: string) => void
    /** AI state for a field (undefined = no AI for this card). */
    aiFor?: (field: string) => FieldAi
    instruction?: string
    onInstructionChange?: (value: string) => void
    /** "Scheduled · …" / "Posts immediately". */
    headerChip?: React.ReactNode
    /** The card's Schedule control. */
    scheduleSlot?: React.ReactNode
}) {
    const [showMore, setShowMore] = useState(false)
    const fields = capabilities.fields.filter((f) => !f.mediaType || f.mediaType === mediaType)
    const required = fields.filter((f) => f.required)
    const optional = fields.filter((f) => !f.required)
    const fieldError = (name: string) => issues.find((i) => i.field === name)?.message
    const general = issues.filter((i) => !fields.some((f) => f.name === i.field))
    const ready = issues.length === 0
    const optionalFilled = optional.filter((f) => !isEmpty(input[f.name])).length

    const selected = override ?? photos.map((p) => p.id)
    const tooMany = mediaType === 'photos' && selected.length > capabilities.maxPhotos
    const isShort =
        capabilities.mediaRules.shortMaxSeconds &&
        video?.orientation === 'portrait' &&
        (video.durationSeconds ?? Infinity) <= capabilities.mediaRules.shortMaxSeconds

    const render = (field: (typeof fields)[number]) => (
        <ComposeFieldControl
            key={field.name}
            field={field}
            value={input[field.name]}
            error={fieldError(field.name)}
            socialConnectionId={connection.id}
            onChange={(value) => onChange(field.name, value)}
            ai={field.ai ? aiFor?.(field.name) : undefined}
            platform={capabilities.platform}
            mentionsEnabled={capabilities.mentions.supported && field.kind === 'textarea'}
            mentions={Array.isArray(input.mentions) ? (input.mentions as MentionRange[]) : []}
            onMentionsChange={(ranges) => onChange('mentions', ranges)}
        />
    )

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-4">
                    <AccountAvatar connection={connection} />
                    <div className="flex min-w-0 flex-col">
                        <CardTitle>{accountName(connection)}</CardTitle>
                        <span className="text-meta">{capabilities.label}</span>
                        {headerChip ? <span className="mt-1">{headerChip}</span> : null}
                    </div>
                </div>
                <CardAction>
                    <div className="flex items-center gap-2">
                        {onInstructionChange ? (
                            <InstructionControl
                                value={instruction ?? ''}
                                onChange={onInstructionChange}
                                label="Instructions for this account"
                            />
                        ) : null}
                        {copySources.length > 0 ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger render={<Button variant="ghost" size="sm" leftIcon={<CopyIcon aria-hidden />} />}>
                                    Copy Text From…
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {copySources.map((source) => (
                                        <DropdownMenuItem key={source.id} onClick={() => onCopyFrom(source.id)}>
                                            {source.name}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : null}
                        {ready ? (
                            <Badge variant="success">
                                <CircleCheckIcon aria-hidden />
                                Ready
                            </Badge>
                        ) : (
                            <Badge variant="destructive">
                                <CircleAlertIcon aria-hidden />
                                {issues.length} issue{issues.length === 1 ? '' : 's'}
                            </Badge>
                        )}
                    </div>
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {scheduleSlot}
                {general.map((issue) => (
                    <Alert key={`${issue.field}-${issue.message}`} variant="destructive">
                        <AlertDescription>{issue.message}</AlertDescription>
                        {tooMany && issue.field === 'media' ? (
                            <AlertAction>
                                <Button variant="secondary" size="sm" onClick={() => onOverride(selected.slice(0, capabilities.maxPhotos))}>
                                    {`Use First ${capabilities.maxPhotos}`}
                                </Button>
                            </AlertAction>
                        ) : null}
                    </Alert>
                ))}
                {isShort ? (
                    <Alert variant="info">
                        <InfoIcon aria-hidden />
                        <AlertTitle>This will publish as a Short</AlertTitle>
                        <AlertDescription>The video is vertical and at most 3 minutes long.</AlertDescription>
                    </Alert>
                ) : null}

                {mediaType === 'video' && capabilities.supportsThumbnail ? (
                    <div className="flex items-center gap-4">
                        <span className="w-24 shrink-0 overflow-hidden rounded-control border border-border">
                            <MediaPreview type="image" url={thumbnail?.url ?? null} alt={thumbnail?.name ?? 'No thumbnail'} />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-label text-foreground">Thumbnail</span>
                            <span className="truncate text-meta">
                                {thumbnail ? thumbnail.name : 'Platform default (auto-generated)'}
                                {thumbnailInherited ? ' · same as all accounts' : ''}
                            </span>
                        </div>
                        {onResetThumbnail ? (
                            <Button variant="ghost" size="sm" onClick={onResetThumbnail}>
                                Use Default
                            </Button>
                        ) : null}
                        <Button variant="secondary" size="sm" leftIcon={<ImageIcon aria-hidden />} onClick={onPickThumbnail}>
                            {thumbnailInherited ? 'Pick Own' : thumbnail ? 'Change' : 'Pick Thumbnail'}
                        </Button>
                    </div>
                ) : null}

                {mediaType === 'photos' && photos.length > 1 ? (
                    <fieldset className="flex flex-col gap-2">
                        <legend className="text-label text-foreground">
                            Photos for this account <span className="text-mono text-muted-foreground">{selected.length}/{capabilities.maxPhotos}</span>
                        </legend>
                        <ul className="flex flex-wrap gap-2">
                            {photos.map((photo) => {
                                const checked = selected.includes(photo.id)
                                return (
                                    <li key={photo.id}>
                                        <label className="flex items-center gap-2 rounded-control border border-border px-2 py-1 text-meta">
                                            <Checkbox
                                                checked={checked}
                                                onCheckedChange={(next) => {
                                                    const ids = photos.map((p) => p.id).filter((id) => (id === photo.id ? next === true : selected.includes(id)))
                                                    onOverride(ids.length === photos.length ? undefined : ids)
                                                }}
                                            />
                                            {photo.name}
                                        </label>
                                    </li>
                                )
                            })}
                        </ul>
                    </fieldset>
                ) : null}

                {required.map(render)}
                {optional.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={showMore}
                            leftIcon={<ChevronDownIcon aria-hidden className={showMore ? 'rotate-180' : undefined} />}
                            onClick={() => setShowMore((v) => !v)}
                        >
                            {`More Options${optionalFilled ? ` (${optionalFilled} set)` : ''}`}
                        </Button>
                        {showMore || optional.some((f) => fieldError(f.name)) ? optional.map(render) : null}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    )
}
