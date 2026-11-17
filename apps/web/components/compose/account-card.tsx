'use client'

import { ChevronDownIcon, CircleAlertIcon, CircleCheckIcon, CopyIcon, DownloadIcon, HandIcon, ImageIcon, InfoIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { isValidElement, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { RouterOutputs } from '@repo/trpc/client'
import { providers } from '~/components/connections/providers'
import { MediaPreview } from '~/components/media/media-preview'
import { UploadRing } from '~/components/uploads/upload-ring'
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
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import {
    AI_SOURCE_LABEL,
    bandOf,
    downloadBase64,
    isEmpty,
    isManualPost,
    postTypeOf,
    tagModeOf,
    textFieldOf,
    type AiSource,
    type Capabilities,
    type ComposeMediaType,
    type DraftUserTag,
    type Issue,
    type MediaLite,
    type TaggedUser,
} from '~/lib/compose'
import { trpc } from '~/trpc/client'

import { ComposeFieldControl, type FieldAi } from './compose-field'
import { InstructionControl } from './instruction-control'
import type { MentionRange } from './mention-editor'
import { isTagPlatform, PositionedTagger, TagList } from './tag-editor'

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
function AccountCardBody({
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
    aiSource,
    aiBusy = false,
    onRegenerate,
    onRegenerateHook,
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
    /** What the last generation wrote this card from. */
    aiSource?: AiSource
    aiBusy?: boolean
    /** Rewrite every AI field on this card (reuses the brief). Undefined = no AI source picked. */
    onRegenerate?: () => void
    /** Rewrite only the title / first line. */
    onRegenerateHook?: () => void
}) {
    const [showMore, setShowMore] = useState(false)
    // Collaborators get their own chip list when the platform declares them.
    const fields = capabilities.fields.filter(
        (f) => (!f.mediaType || f.mediaType === mediaType) && !(capabilities.collaborators && f.name === 'collaborators')
    )
    const required = fields.filter((f) => f.required)
    const optional = fields.filter((f) => !f.required)
    const fieldError = (name: string) => issues.find((i) => i.field === name)?.message
    // Tag and collaborator errors show next to their own controls.
    const general = issues.filter((i) => !fields.some((f) => f.name === i.field) && !['collaborators', ...(tagModeOf(capabilities, mediaType) === 'none' ? [] : ['tags'])].includes(i.field))
    const ready = issues.length === 0
    const optionalFilled = optional.filter((f) => !isEmpty(input[f.name])).length

    const selected = override ?? photos.map((p) => p.id)
    const postType = postTypeOf(capabilities, mediaType, video, selected.length)
    const altTexts = (input.altTexts ?? {}) as Record<string, string>
    const altField = capabilities.fields.find((f) => f.name === 'altText')
    const altBand = altField ? bandOf(altField, postType) : undefined
    const slides = photos.filter((p) => selected.includes(p.id))
    const perSlideAlt = mediaType === 'photos' && slides.length > 1 ? capabilities.perImageAltTextMax : undefined
    const manual = isManualPost(capabilities, mediaType, selected.length)
    const photoLimit = manual ? capabilities.carouselMax : capabilities.maxPhotos
    const tooMany = mediaType === 'photos' && selected.length > photoLimit

    // ---- Tags (from capabilities.tagging; separate from @mentions in the text)
    const tagMode = tagModeOf(capabilities, mediaType)
    const tagPlatform = isTagPlatform(capabilities.platform) ? capabilities.platform : null
    const userTags = (Array.isArray(input.userTags) ? input.userTags : []) as DraftUserTag[]
    const taggedUsers = (Array.isArray(input.taggedUsers) ? input.taggedUsers : []) as TaggedUser[]
    const collaborators = (Array.isArray(input.collaborators) ? input.collaborators : []) as string[]
    const [failedTags, setFailedTags] = useState<Record<string, string>>({})
    const resolveX = trpc.mentions.resolveX.useMutation({ onError: () => undefined })
    const zip = trpc.media.zip.useMutation()
    const manualText = textFieldOf(capabilities, mediaType)
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
            band={field.ai ? bandOf(field, postType) : undefined}
            short={Boolean(isShort)}
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
                        {manual ? (
                            <span className="mt-1">
                                <Badge variant="warning">
                                    <HandIcon aria-hidden />
                                    Manual post
                                </Badge>
                            </span>
                        ) : null}
                        {headerChip ? <span className="mt-1">{headerChip}</span> : null}
                    </div>
                </div>
                <CardAction>
                    <div className="flex items-center gap-2">
                        {aiSource ? (
                            <Badge variant="neutral">
                                <SparklesIcon aria-hidden />
                                {AI_SOURCE_LABEL[aiSource]}
                            </Badge>
                        ) : null}
                        {onRegenerate ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={`Write ${accountName(connection)} with AI`}
                                            loading={aiBusy}
                                            leftIcon={<SparklesIcon aria-hidden />}
                                        />
                                    }
                                />
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={onRegenerate}>Regenerate This Account</DropdownMenuItem>
                                    {onRegenerateHook ? <DropdownMenuItem onClick={onRegenerateHook}>Regenerate Hook Only</DropdownMenuItem> : null}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : null}
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
                {manual ? (
                    <Alert variant="info">
                        <InfoIcon aria-hidden />
                        <AlertTitle>{`${capabilities.label} doesn’t allow apps to publish image posts`}</AlertTitle>
                        <AlertDescription>
                            Fannout saves the text and the images. Copy the text, download the images, post them in the {capabilities.label} app, then
                            mark the post as posted.
                        </AlertDescription>
                        <AlertAction>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    leftIcon={<CopyIcon aria-hidden />}
                                    onClick={async () => {
                                        const text = manualText ? input[manualText.name] : undefined
                                        if (typeof text !== 'string' || !text.trim()) return toast.error('Write the post text first')
                                        await navigator.clipboard.writeText(text)
                                        toast.success('Text copied')
                                    }}
                                >
                                    Copy Text
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    leftIcon={<DownloadIcon aria-hidden />}
                                    loading={zip.isPending}
                                    onClick={async () => {
                                        try {
                                            const file = await zip.mutateAsync({ mediaIds: selected })
                                            downloadBase64(file.filename, file.base64, 'application/zip')
                                        } catch {
                                            // The global mutation handler shows the error toast.
                                        }
                                    }}
                                >
                                    Download Images
                                </Button>
                            </div>
                        </AlertAction>
                    </Alert>
                ) : (
                    scheduleSlot
                )}
                {general.map((issue) => (
                    <Alert key={`${issue.field}-${issue.message}`} variant="destructive">
                        <AlertDescription>{issue.message}</AlertDescription>
                        {tooMany && issue.field === 'media' ? (
                            <AlertAction>
                                <Button variant="secondary" size="sm" onClick={() => onOverride(selected.slice(0, photoLimit))}>
                                    {`Use First ${photoLimit}`}
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
                        <span className="relative w-24 shrink-0 overflow-hidden rounded-control border border-border">
                            <MediaPreview type="image" url={thumbnail?.url ?? null} thumbUrl={thumbnail?.thumbUrl} alt={thumbnail?.name ?? 'No thumbnail'} />
                            {thumbnail ? <UploadRing mediaId={thumbnail.id} fallbackStatus={thumbnail.status} /> : null}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-label text-foreground">Thumbnail</span>
                            <span className="truncate text-meta">
                                {thumbnail ? thumbnail.name : 'Platform default (auto-generated)'}
                                {thumbnailInherited ? ' · auto-assigned' : ''}
                                {capabilities.thumbnailRules ? ` · ${capabilities.thumbnailRules.recommended}` : ''}
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
                            Photos for this account <span className="text-mono text-muted-foreground">{selected.length}/{photoLimit}</span>
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

                {tagPlatform && tagMode === 'positioned' && slides.length ? (
                    <fieldset className="flex flex-col gap-4">
                        <legend className="text-label text-foreground">Tag people</legend>
                        {slides.map((photo, index) => (
                            <PositionedTagger
                                key={photo.id}
                                platform={tagPlatform}
                                photo={photo}
                                title={slides.length > 1 ? `Slide ${index + 1}` : 'Photo'}
                                max={capabilities.tagging.max}
                                tags={userTags
                                    .filter((tag) => tag.mediaId === photo.id && tag.x !== undefined && tag.y !== undefined)
                                    .map((tag) => ({ username: tag.username, x: tag.x!, y: tag.y! }))}
                                onChange={(next) => {
                                    const rest = userTags.filter((tag) => tag.mediaId !== photo.id)
                                    const all = [...rest, ...next.map((tag) => ({ ...tag, mediaId: photo.id }))]
                                    onChange('userTags', all.length ? all : undefined)
                                }}
                            />
                        ))}
                    </fieldset>
                ) : null}
                {tagPlatform && tagMode === 'list' && !capabilities.tagging.needsUserId ? (
                    <TagList
                        platform={tagPlatform}
                        label="Tag people"
                        helper={`Public accounts only, up to ${capabilities.tagging.max}.`}
                        usernames={userTags.map((tag) => tag.username)}
                        max={capabilities.tagging.max}
                        error={fieldError('tags')}
                        onAdd={(username) => onChange('userTags', [...userTags, { username }])}
                        onRemove={(username) => {
                            const next = userTags.filter((tag) => tag.username !== username)
                            onChange('userTags', next.length ? next : undefined)
                        }}
                    />
                ) : null}
                {tagPlatform && tagMode === 'list' && capabilities.tagging.needsUserId ? (
                    <TagList
                        platform={tagPlatform}
                        label="Tag people"
                        helper={`Tags on the ${mediaType === 'video' ? 'video' : 'photos'}, up to ${capabilities.tagging.max}. Separate from @mentions in the text. People can turn tagging off; then the post goes out without tags.`}
                        usernames={taggedUsers.map((tag) => tag.username)}
                        max={capabilities.tagging.max}
                        pending={resolveX.isPending}
                        failed={failedTags}
                        error={fieldError('tags')}
                        onDismissFailed={(username) =>
                            setFailedTags((current) => Object.fromEntries(Object.entries(current).filter(([name]) => name !== username)))
                        }
                        onAdd={async (username) => {
                            // One lookup per new username; the server keeps the id on the contact, so it is never paid for twice.
                            try {
                                const user = await resolveX.mutateAsync({ socialConnectionId: connection.id, username })
                                if (!taggedUsers.some((tag) => tag.xUserId === user.xUserId)) {
                                    onChange('taggedUsers', [...taggedUsers, { username: user.username, xUserId: user.xUserId }])
                                }
                            } catch (error) {
                                const message = error instanceof Error && /not found/i.test(error.message) ? 'no such account' : 'couldn’t be checked'
                                setFailedTags((current) => ({ ...current, [username]: message }))
                            }
                        }}
                        onRemove={(username) => {
                            const next = taggedUsers.filter((tag) => tag.username !== username)
                            onChange('taggedUsers', next.length ? next : undefined)
                        }}
                    />
                ) : null}
                {tagPlatform && capabilities.collaborators ? (
                    <TagList
                        platform={tagPlatform}
                        label="Collaborators"
                        helper="Each collaborator must accept the invite in the app before the post shows on their profile."
                        usernames={collaborators}
                        max={capabilities.collaborators.max}
                        error={fieldError('collaborators')}
                        onAdd={(username) => onChange('collaborators', [...collaborators, username])}
                        onRemove={(username) => {
                            const next = collaborators.filter((name) => name !== username)
                            onChange('collaborators', next.length ? next : undefined)
                        }}
                    />
                ) : null}

                {perSlideAlt ? (
                    <fieldset className="flex flex-col gap-2">
                        <legend className="text-label text-foreground">Alt text per slide</legend>
                        <ol className="flex flex-col gap-4">
                            {slides.map((photo, index) => (
                                <li key={photo.id} className="flex items-start gap-4">
                                    <span className="w-16 shrink-0 overflow-hidden rounded-control border border-border">
                                        <MediaPreview type="image" url={photo.url} thumbUrl={photo.thumbUrl} alt={photo.name} />
                                    </span>
                                    <FormField
                                        className="min-w-0 flex-1"
                                        label={`Slide ${index + 1}`}
                                        counter={{ value: altTexts[photo.id] ?? '', limit: perSlideAlt, band: altBand }}
                                    >
                                        {(p) => (
                                            <Input
                                                {...p}
                                                value={altTexts[photo.id] ?? ''}
                                                placeholder="Describe this photo for people who can’t see it"
                                                onChange={(e) => {
                                                    const next = { ...altTexts }
                                                    if (e.target.value) next[photo.id] = e.target.value
                                                    else delete next[photo.id]
                                                    onChange('altTexts', Object.keys(next).length ? next : undefined)
                                                }}
                                            />
                                        )}
                                    </FormField>
                                </li>
                            ))}
                        </ol>
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

type AccountCardProps = React.ComponentProps<typeof AccountCardBody>

const same = <T,>(a: T[], b: T[], eq: (x: T, y: T) => boolean = Object.is) => a.length === b.length && a.every((x, i) => eq(x, b[i]!))

function shallowEqualRecord(a: Record<string, unknown>, b: Record<string, unknown>) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]))
}

/** Slots are re-created by the parent every render: compare type + data props (functions are stable proxies / id-only closures). */
function slotEqual(a: ReactNode, b: ReactNode) {
    if (a === b) return true
    if (!isValidElement(a) || !isValidElement(b) || a.type !== b.type) return false
    const pa = a.props as Record<string, unknown>
    const pb = b.props as Record<string, unknown>
    const data = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v !== 'function'))
    return shallowEqualRecord(data(pa), data(pb)) && Object.keys(pa).filter((k) => typeof pa[k] === 'function').join() === Object.keys(pb).filter((k) => typeof pb[k] === 'function').join()
}

function cardPropsEqual(prev: AccountCardProps, next: AccountCardProps) {
    if (
        !Object.is(prev.connection, next.connection) ||
        !Object.is(prev.capabilities, next.capabilities) ||
        prev.mediaType !== next.mediaType ||
        !Object.is(prev.video, next.video) ||
        !Object.is(prev.thumbnail, next.thumbnail) ||
        prev.thumbnailInherited !== next.thumbnailInherited ||
        prev.instruction !== next.instruction ||
        prev.aiSource !== next.aiSource ||
        prev.aiBusy !== next.aiBusy ||
        Boolean(prev.onRegenerate) !== Boolean(next.onRegenerate) ||
        Boolean(prev.onRegenerateHook) !== Boolean(next.onRegenerateHook) ||
        Boolean(prev.onResetThumbnail) !== Boolean(next.onResetThumbnail) ||
        Boolean(prev.onInstructionChange) !== Boolean(next.onInstructionChange) ||
        Boolean(prev.aiFor) !== Boolean(next.aiFor)
    ) {
        return false
    }
    if (!shallowEqualRecord(prev.input, next.input)) return false
    if (!same(prev.photos, next.photos)) return false
    if (!(prev.override === next.override || (prev.override && next.override && same(prev.override, next.override)))) return false
    if (!same(prev.issues, next.issues, (x, y) => x === y || (x.field === y.field && x.message === y.message))) return false
    if (!same(prev.copySources, next.copySources, (x, y) => x.id === y.id && x.name === y.name)) return false
    if (!slotEqual(prev.headerChip, next.headerChip) || !slotEqual(prev.scheduleSlot, next.scheduleSlot)) return false
    if (prev.aiFor && next.aiFor) {
        for (const field of next.capabilities.fields) {
            if (!field.ai) continue
            const a = prev.aiFor(field.name)
            const b = next.aiFor(field.name)
            if (a.enabled !== b.enabled || a.busy !== b.busy || a.filled !== b.filled || !Object.is(a.issue, b.issue)) return false
        }
    }
    return true
}

const MemoAccountCardBody = memo(AccountCardBody, cardPropsEqual)

/**
 * The parent re-creates every callback and slot on each keystroke. This shell keeps the
 * latest props in a ref and hands the memoized body stable proxies, so only the card whose
 * data changed re-renders, and a skipped card's handlers still call the freshest callbacks.
 */
export function AccountCard(props: AccountCardProps) {
    const latest = useRef(props)
    useLayoutEffect(() => {
        latest.current = props
    })
    const stable = useMemo(
        () => ({
            onChange: (field: string, value: unknown) => latest.current.onChange(field, value),
            onPickThumbnail: () => latest.current.onPickThumbnail(),
            onOverride: (ids: string[] | undefined) => latest.current.onOverride(ids),
            onCopyFrom: (sourceId: string) => latest.current.onCopyFrom(sourceId),
            onResetThumbnail: () => latest.current.onResetThumbnail?.(),
            onInstructionChange: (value: string) => latest.current.onInstructionChange?.(value),
            onRegenerate: () => latest.current.onRegenerate?.(),
            onRegenerateHook: () => latest.current.onRegenerateHook?.(),
        }),
        []
    )
    const source = props.aiFor
    const aiFor = source
        ? (field: string) => ({
              ...source(field),
              onGenerate: () => latest.current.aiFor?.(field).onGenerate(),
              onUndo: () => latest.current.aiFor?.(field).onUndo(),
          })
        : undefined
    return (
        <MemoAccountCardBody
            {...props}
            onChange={stable.onChange}
            onPickThumbnail={stable.onPickThumbnail}
            onOverride={stable.onOverride}
            onCopyFrom={stable.onCopyFrom}
            onResetThumbnail={props.onResetThumbnail ? stable.onResetThumbnail : undefined}
            onInstructionChange={props.onInstructionChange ? stable.onInstructionChange : undefined}
            onRegenerate={props.onRegenerate ? stable.onRegenerate : undefined}
            onRegenerateHook={props.onRegenerateHook ? stable.onRegenerateHook : undefined}
            aiFor={aiFor}
        />
    )
}
