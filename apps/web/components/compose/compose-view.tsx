'use client'

import { BracesIcon, CalendarClockIcon, CaptionsIcon, ChevronDownIcon, FilmIcon, GripVerticalIcon, ImageIcon, ImagesIcon, SendIcon, SparklesIcon, TriangleAlertIcon, UsersIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { RouterOutputs } from '@repo/trpc/client'
import { MediaPreview } from '~/components/media/media-preview'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { ButtonGroup } from '~/components/ui/button-group'
import { formatScheduled } from '~/lib/schedule'
import { ScheduleChip, ScheduleControl, ScheduleDialog } from './schedule-control'
import { EmptyState } from '~/components/ui/empty-state'
import { Skeleton } from '~/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import {
    clearDraft,
    emptyDraft,
    isEmpty,
    loadDraft,
    platformOf,
    prefersPortrait,
    sameValue,
    saveDraft,
    textFieldOf,
    type Capabilities,
    type ComposeDraft,
    type Issue,
    type MediaLite,
} from '~/lib/compose'
import { normalizeTRPCError } from '~/lib/error'
import { formatDuration } from '~/lib/media-format'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'
import { InfiniteList } from '~/components/infinite-list'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'

import { AccountAvatar, AccountCard, accountName } from './account-card'
import { InstructionControl } from './instruction-control'
import { MediaPickerDialog } from './media-picker-dialog'

type Connection = RouterOutputs['socialConnections']['list']['items'][number]
type AiFill = { connectionId: string; field: string; value: unknown }
type AiIssue = RouterOutputs['ai']['getGeneration']['issues'][number]

/** Fields with a defaultValue start filled so required selects aren't empty. */
function initialInput(capabilities: Capabilities): Record<string, unknown> {
    return Object.fromEntries(
        capabilities.fields.filter((f) => f.defaultValue !== undefined).map((f) => [f.name, f.defaultValue])
    )
}

/** Only fields that apply to the media type, without empty values. */
function cleanInput(capabilities: Capabilities, mediaType: 'video' | 'photos', input: Record<string, unknown> = {}) {
    const cleaned = Object.fromEntries(
        capabilities.fields
            .filter((f) => !f.mediaType || f.mediaType === mediaType)
            .filter((f) => !isEmpty(input[f.name]))
            .map((f) => [f.name, input[f.name]])
    )
    if (capabilities.platform === 'linkedin' && Array.isArray(input.mentions) && input.mentions.length) cleaned.mentions = input.mentions
    return cleaned
}

function SectionCard({
    step,
    title,
    description,
    action,
    children,
}: {
    step: number
    title: string
    description?: string
    /** Rendered top-right of the header (CardAction). */
    action?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <span className="text-mono text-muted-foreground">{step}.</span> {title}
                </CardTitle>
                {description ? <CardDescription>{description}</CardDescription> : null}
                {action ? <CardAction>{action}</CardAction> : null}
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    )
}

export function ComposeView() {
    const router = useRouter()
    const utils = trpc.useUtils()
    const capabilitiesQuery = trpc.platforms.capabilities.useQuery({}, { staleTime: 60 * 60 * 1000 })
    const connectionsQuery = trpc.socialConnections.list.useInfiniteQuery({}, infiniteOptions({ staleTime: 0 }))
    const connectionList = useInfiniteList(connectionsQuery)

    const [draft, setDraft] = useState<ComposeDraft>(emptyDraft)
    const [hydrated, setHydrated] = useState(false)
    const [cache, setCache] = useState<Record<string, MediaLite>>({})
    // connectionId null = the shared thumbnail for all accounts.
    const [picker, setPicker] = useState<null | { kind: 'video' | 'photos' } | { kind: 'thumbnail'; connectionId: string | null }>(null)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [scheduleAllOpen, setScheduleAllOpen] = useState(false)
    const [issues, setIssues] = useState<Issue[]>([])
    const [dragId, setDragId] = useState<string | null>(null)
    const [aiPicker, setAiPicker] = useState<null | 'json' | 'subtitle'>(null)
    const [generation, setGeneration] = useState<null | { id: string }>(null)
    const [pendingFill, setPendingFill] = useState<null | { fills: AiFill[]; edited: AiFill[]; issues: AiIssue[] }>(null)
    // Set when "Replace" ran, so the dialog's close handler doesn't also apply "Keep Mine".
    const replaced = useRef(false)

    // Restore the local draft once (client only), then autosave every change.
    useEffect(() => {
        const saved = loadDraft()
        if (saved) setDraft(saved)
        setHydrated(true)
    }, [])
    useEffect(() => {
        if (hydrated) saveDraft(draft)
    }, [draft, hydrated])

    const remember = (items: MediaLite[]) =>
        setCache((current) => ({ ...current, ...Object.fromEntries(items.map((m) => [m.id, m])) }))

    // Media referenced by a restored draft but not loaded yet.
    const referenced = useMemo(
        () =>
            [...new Set([draft.videoId, ...draft.photoIds, ...Object.values(draft.thumbnails), draft.thumbnailAll, draft.aiJsonId, draft.aiSubtitleId].filter(Boolean) as string[])].filter(
                (id) => !cache[id]
            ),
        [draft, cache]
    )
    const restored = trpc.useQueries((t) => referenced.map((mediaId) => t.media.get({ mediaId }, { retry: false })))
    useEffect(() => {
        const loaded = restored.map((q) => q.data).filter((m): m is NonNullable<typeof m> => Boolean(m))
        if (loaded.length) remember(loaded)
    }, [restored])

    const capabilities = useMemo(
        () => new Map((capabilitiesQuery.data ?? []).map((c) => [c.platform, c])),
        [capabilitiesQuery.data]
    )
    const connections = connectionList.items.filter((c) => c.status !== 'disconnected' || draft.accountIds.includes(c.id))
    const capsFor = (connection: Connection) => {
        const platform = platformOf(connection.provider)
        return platform ? capabilities.get(platform) : undefined
    }
    const supports = (connection: Connection) => {
        const caps = capsFor(connection)
        return caps ? (draft.mediaType === 'video' ? caps.supportsVideo : caps.supportsPhotos) : false
    }

    const selected = draft.accountIds
        .map((id) => connections.find((c) => c.id === id))
        .filter((c): c is Connection => Boolean(c))
    const targets = selected.filter((c) => supports(c) && c.status === 'connected')
    const excluded = selected.filter((c) => !supports(c))
    const video = draft.videoId ? (cache[draft.videoId] ?? null) : null
    /** A card's own thumbnail, else the shared one. */
    const thumbnailOf = (connectionId: string) => draft.thumbnails[connectionId] ?? draft.thumbnailAll
    const sharedThumb = draft.thumbnailAll ? (cache[draft.thumbnailAll] ?? null) : null
    const thumbTargets = targets.filter((c) => capsFor(c)?.supportsThumbnail)
    const photos = draft.photoIds.map((id) => cache[id]).filter((m): m is MediaLite => Boolean(m))
    const mediaIds = draft.mediaType === 'video' ? (draft.videoId ? [draft.videoId] : []) : draft.photoIds

    const update = (patch: Partial<ComposeDraft> | ((d: ComposeDraft) => Partial<ComposeDraft>)) =>
        setDraft((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))

    const toggleAccount = (connection: Connection, checked: boolean) =>
        update((d) => {
            const caps = capsFor(connection)
            return {
                accountIds: checked ? [...d.accountIds, connection.id] : d.accountIds.filter((id) => id !== connection.id),
                inputs:
                    checked && caps && !d.inputs[connection.id]
                        ? { ...d.inputs, [connection.id]: initialInput(caps) }
                        : d.inputs,
            }
        })

    // Folder → video by role (portrait/landscape by platforms), primary thumbnail, photos.
    const applyFolder = async (folderId: string) => {
        const folder = await utils.folders.get.fetch({ folderId })
        // Only the roles we need, one page each (folders.items is paginated).
        const byRole = async (role: 'main_landscape' | 'main_portrait' | 'thumbnail' | 'social_json' | 'subtitles') =>
            (folder.roleCounts[role] ?? 0) > 0 ? (await utils.folders.items.fetch({ folderId, role })).items : []
        const [landscape, portrait, thumbs, jsons, subs] = await Promise.all(
            (['main_landscape', 'main_portrait', 'thumbnail', 'social_json', 'subtitles'] as const).map(byRole)
        )
        type Item = RouterOutputs['folders']['items']['items'][number]
        const lite = (item: Item): MediaLite => ({
            id: item.media.id,
            name: item.media.name,
            type: item.media.type,
            status: item.media.status,
            url: item.media.previewUrl,
            orientation: item.media.orientation,
            durationSeconds: item.media.durationSeconds,
            width: item.media.width,
            height: item.media.height,
        })
        remember([...landscape!, ...portrait!, ...thumbs!, ...jsons!, ...subs!].map(lite))
        const primary = (items: Item[]) => [...items].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.position - b.position)[0]
        const platforms = targets.map((c) => platformOf(c.provider)).filter((p): p is NonNullable<typeof p> => Boolean(p))
        const main = prefersPortrait(platforms) ? (primary(portrait!) ?? primary(landscape!)) : (primary(landscape!) ?? primary(portrait!))
        const thumb = primary(thumbs!)
        const images = [...thumbs!].sort((a, b) => a.position - b.position)
        const json = primary(jsons!)
        const subtitles = primary(subs!)
        update((d) => ({
            folderId,
            aiJsonId: d.aiJsonId ?? json?.mediaId ?? null,
            aiSubtitleId: d.aiSubtitleId ?? subtitles?.mediaId ?? null,
            videoId: d.mediaType === 'video' ? (main?.mediaId ?? d.videoId) : d.videoId,
            photoIds: d.mediaType === 'photos' && images.length ? images.map((i) => i.mediaId) : d.photoIds,
            // The folder's thumbnail becomes the shared one; cards keep their own picks.
            thumbnailAll: d.thumbnailAll ?? thumb?.mediaId ?? null,
        }))
        toast.success(`Filled from ${folder.name}`)
    }

    // Live validation with the platforms' own schemas (server dry run).
    const payload = useMemo(
        () => ({
            idempotencyKey: draft.idempotencyKey,
            mediaType: draft.mediaType,
            mediaIds,
            // AI names the post from the social JSON when one is picked.
            ...(draft.aiJsonId ? { jsonMediaId: draft.aiJsonId } : {}),
            ...(draft.scheduleAll ? { scheduleAll: draft.scheduleAll } : {}),
            ...(draft.mediaType === 'video'
                ? {
                      thumbnailByConnection: Object.fromEntries(
                          targets
                              .filter((c) => capsFor(c)?.supportsThumbnail && thumbnailOf(c.id))
                              .map((c) => [c.id, thumbnailOf(c.id) as string])
                      ),
                  }
                : {}),
            targets: targets.map((c) => ({
                socialConnectionId: c.id,
                input: cleanInput(capsFor(c)!, draft.mediaType, draft.inputs[c.id]),
                ...(draft.mediaType === 'photos' && draft.photoOverrides[c.id] ? { mediaIds: draft.photoOverrides[c.id] } : {}),
                ...(draft.schedules?.[c.id] ? { schedule: draft.schedules[c.id] } : {}),
            })),
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from draft + loaded lists
        [draft, connectionsQuery.data, capabilitiesQuery.data]
    )
    const debouncedPayload = useDebouncedValue(payload, 500)
    const validate = trpc.posts.validate.useMutation({ onError: () => undefined })
    const latest = useRef(0)
    useEffect(() => {
        if (debouncedPayload.targets.length === 0 || debouncedPayload.mediaIds.length === 0) return setIssues([])
        const run = ++latest.current
        validate.mutateAsync(debouncedPayload).then(
            (result) => run === latest.current && setIssues(result.issues),
            () => undefined
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the payload changes
    }, [debouncedPayload])

    const publish = trpc.posts.publishBatch.useMutation({
        onError: (error) => {
            const { details } = normalizeTRPCError(error)
            const found = (details as { issues?: Issue[] } | undefined)?.issues
            if (found) setIssues(found)
        },
    })


    // ---------------------------------------------------------------- AI
    const aiEnabled = Boolean(draft.aiJsonId || draft.aiSubtitleId)
    const aiFieldsOf = (connection: Connection) =>
        (capsFor(connection)?.fields ?? []).filter((f) => f.ai && (!f.mediaType || f.mediaType === draft.mediaType))
    const generate = trpc.ai.generate.useMutation()
    const generationQuery = trpc.ai.getGeneration.useQuery(
        { generationId: generation?.id ?? '' },
        { enabled: Boolean(generation), staleTime: 0, refetchInterval: 1500 }
    )
    const aiBusy = Boolean(generation) || generate.isPending

    const applyFills = (fills: AiFill[], issues: AiIssue[]) =>
        update((d) => {
            const inputs = { ...d.inputs }
            const aiFills = { ...d.aiFills }
            const aiIssues = { ...d.aiIssues }
            for (const fill of fills) {
                const previous = d.inputs[fill.connectionId]?.[fill.field]
                inputs[fill.connectionId] = { ...inputs[fill.connectionId], [fill.field]: fill.value }
                aiFills[fill.connectionId] = { ...aiFills[fill.connectionId], [fill.field]: { value: fill.value, previous } }
                const rest = { ...aiIssues[fill.connectionId] }
                delete rest[fill.field]
                aiIssues[fill.connectionId] = rest
            }
            for (const issue of issues) {
                aiIssues[issue.socialConnectionId] = { ...aiIssues[issue.socialConnectionId], [issue.field]: issue.message }
            }
            return { inputs, aiFills, aiIssues }
        })

    // Generation finished: fill fields, asking before overwriting anything the user typed.
    useEffect(() => {
        const result = generationQuery.data
        if (!result || result.status === 'queued' || result.status === 'running') return
        setGeneration(null)
        if (result.status === 'failed') {
            toast.error(result.error?.message ?? 'AI generation failed')
            return
        }
        const fills: AiFill[] = Object.entries(result.output ?? {}).flatMap(([connectionId, fields]) =>
            Object.entries(fields).map(([field, value]) => ({ connectionId, field, value }))
        )
        const edited = fills.filter((fill) => {
            const current = draft.inputs[fill.connectionId]?.[fill.field]
            const byAi = draft.aiFills[fill.connectionId]?.[fill.field]
            return !isEmpty(current) && !sameValue(current, fill.value) && !(byAi && sameValue(current, byAi.value))
        })
        if (edited.length) setPendingFill({ fills, edited, issues: result.issues })
        else {
            applyFills(fills, result.issues)
            toast.success(`AI filled ${fills.length} field${fills.length === 1 ? '' : 's'}`)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- react to a finished generation only
    }, [generationQuery.data])

    const instructionFor = (connectionId: string) => draft.accountInstructions[connectionId]?.trim() || undefined
    const globalInstruction = draft.globalInstruction.trim() || undefined

    const startGeneration = async (requested: { socialConnectionId: string; fields?: string[] }[]) => {
        if (!aiEnabled || requested.length === 0) return
        try {
            const { generationId } = await generate.mutateAsync({
                ...(draft.aiJsonId ? { jsonMediaId: draft.aiJsonId } : {}),
                ...(draft.aiSubtitleId ? { subtitleMediaId: draft.aiSubtitleId } : {}),
                ...(draft.mediaType === 'video' && draft.videoId ? { videoMediaId: draft.videoId } : {}),
                ...(globalInstruction ? { globalInstruction } : {}),
                targets: requested.map((target) => ({
                    ...target,
                    ...(instructionFor(target.socialConnectionId) ? { instruction: instructionFor(target.socialConnectionId) } : {}),
                })),
            })
            setGeneration({ id: generationId })
        } catch {
            // The global mutation handler shows the error toast.
        }
    }

    /** Every AI-capable field (titles, descriptions, captions…) on every selected account. */
    const aiTargets = targets.filter((c) => aiFieldsOf(c).length > 0)
    const generateAll = () => void startGeneration(aiTargets.map((c) => ({ socialConnectionId: c.id })))

    const withInstructions = (connectionId: string, fields?: string[]) => ({
        socialConnectionId: connectionId,
        ...(fields ? { fields } : {}),
        ...(instructionFor(connectionId) ? { instruction: instructionFor(connectionId) } : {}),
    })

    const aiFor = (connection: Connection) => (field: string) => {
        const fill = draft.aiFills[connection.id]?.[field]
        return {
            enabled: aiEnabled,
            busy: aiBusy,
            filled: Boolean(fill && sameValue(draft.inputs[connection.id]?.[field], fill.value)),
            issue: draft.aiIssues[connection.id]?.[field],
            onGenerate: () => void startGeneration([withInstructions(connection.id, [field])]),
            onUndo: () =>
                update((d) => {
                    const previous = d.aiFills[connection.id]?.[field]?.previous
                    const fills = { ...d.aiFills[connection.id] }
                    delete fills[field]
                    const notes = { ...d.aiIssues[connection.id] }
                    delete notes[field]
                    return {
                        inputs: { ...d.inputs, [connection.id]: { ...d.inputs[connection.id], [field]: previous } },
                        aiFills: { ...d.aiFills, [connection.id]: fills },
                        aiIssues: { ...d.aiIssues, [connection.id]: notes },
                    }
                }),
        }
    }
    const fieldLabel = (fill: AiFill) => {
        const connection = connections.find((c) => c.id === fill.connectionId)
        const label = connection ? capsFor(connection)?.fields.find((f) => f.name === fill.field)?.label : undefined
        return `${connection ? accountName(connection) : 'Account'} · ${label ?? fill.field}`
    }

    const mediaIssue =
        mediaIds.length === 0 ? (draft.mediaType === 'video' ? 'Pick a video' : 'Pick at least one photo') : null
    const batchIssues = issues.filter((i) => !i.socialConnectionId)
    const pendingValidation = validate.isPending || payload !== debouncedPayload
    // Card time wins; "Schedule all" fills the rest; neither = now.
    const scheduleOf = (connectionId: string) => draft.schedules?.[connectionId] ?? draft.scheduleAll ?? null
    const scheduledCount = targets.filter((c) => scheduleOf(c.id)).length
    const instantCount = targets.length - scheduledCount
    const submitLabel = !scheduledCount
        ? `Post to ${targets.length} Account${targets.length === 1 ? '' : 's'}`
        : !instantCount
          ? `Schedule ${scheduledCount}`
          : `Post ${instantCount} now · Schedule ${scheduledCount}`
    const canPost =
        targets.length > 0 && !mediaIssue && issues.length === 0 && !pendingValidation && excluded.length < selected.length

    if (capabilitiesQuery.isPending || connectionsQuery.isPending) {
        return <Skeleton className="h-96 w-full rounded-surface" aria-busy />
    }
    if (connections.length === 0) {
        return (
            <EmptyState
                icon={UsersIcon}
                title="Connect an account first"
                description="Fannout publishes to the social accounts you connect."
                actions={
                    <Button variant="primary" nativeButton={false} render={<Link href="/connections" />}>
                        Connect Accounts
                    </Button>
                }
            />
        )
    }

    const billed = targets.filter((c) => capsFor(c)?.mediaRules.billed)

    return (
        <div className="flex flex-col gap-8">
            {/* Sticky summary + the one primary action, top right. */}
            <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background/80 px-4 py-4 backdrop-blur md:-mx-6 md:px-6">
                <p className="text-meta">
                    <span className="text-mono text-foreground">{targets.length}</span> account{targets.length === 1 ? '' : 's'} ·{' '}
                    {draft.mediaType === 'video' ? 'Video' : `Photos (${photos.length})`}
                    {excluded.length ? ` · ${excluded.length} excluded` : ''}
                    {pendingValidation && targets.length ? ' · checking…' : ''}
                </p>
                <div className="flex items-center gap-2">
                    {aiEnabled ? (
                        <>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="secondary"
                                    leftIcon={<SparklesIcon aria-hidden />}
                                    loading={aiBusy}
                                    disabled={aiTargets.length === 0}
                                    onClick={generateAll}
                                >
                                    Generate All With AI
                                </Button>
                                <InstructionControl
                                    value={draft.globalInstruction}
                                    onChange={(value) => update({ globalInstruction: value })}
                                    label="Global AI instructions"
                                />
                            </div>
                        </>
                    ) : null}
                    <Button
                        variant="ghost"
                        onClick={() => {
                            clearDraft()
                            setDraft(emptyDraft())
                            setIssues([])
                        }}
                    >
                        Clear Draft
                    </Button>
                    <ButtonGroup>
                        <Button
                            variant="primary"
                            leftIcon={scheduledCount ? <CalendarClockIcon aria-hidden /> : <SendIcon aria-hidden />}
                            disabled={!canPost}
                            loading={publish.isPending}
                            onClick={() => setConfirmOpen(true)}
                        >
                            {submitLabel}
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={<Button variant="primary" aria-label="More publish options" leftIcon={<ChevronDownIcon aria-hidden />} />}
                            />
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setScheduleAllOpen(true)}>
                                    {draft.scheduleAll ? `Schedule all… (${formatScheduled(draft.scheduleAll.at, draft.scheduleAll.timezone)})` : 'Schedule all…'}
                                </DropdownMenuItem>
                                {draft.scheduleAll ? (
                                    <DropdownMenuItem onClick={() => update({ scheduleAll: null })}>Clear “Schedule all”</DropdownMenuItem>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </ButtonGroup>
                </div>
            </div>

            <SectionCard step={1} title="Accounts" description="Tick where this post should go. Cards below follow your selection order.">
                <InfiniteList
                    list={{ ...connectionList, items: connections }}
                    getKey={(connection) => connection.id}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                    skeleton={<Skeleton className="h-16 w-full rounded-surface" />}
                    empty={null}
                    renderItem={(connection) => {
                        const caps = capsFor(connection)
                        const checked = draft.accountIds.includes(connection.id)
                        const unavailable = connection.status !== 'connected' || !caps
                        return (
                            <li>
                                <label
                                    className={cn(
                                        'flex items-center gap-4 rounded-surface border bg-background p-4 transition-colors duration-fast ease-out',
                                        checked ? 'border-primary' : 'border-border',
                                        unavailable ? 'opacity-50' : 'cursor-pointer hover:border-primary'
                                    )}
                                >
                                    <Checkbox
                                        checked={checked}
                                        disabled={unavailable}
                                        onCheckedChange={(next) => toggleAccount(connection, next === true)}
                                        aria-label={`Post to ${accountName(connection)}`}
                                    />
                                    <AccountAvatar connection={connection} />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-label text-foreground">{accountName(connection)}</span>
                                        <span className="text-meta">{caps?.label ?? connection.provider}</span>
                                    </span>
                                    {connection.status !== 'connected' ? (
                                        <Link href="/connections" className="text-link hover:underline">
                                            Reconnect
                                        </Link>
                                    ) : checked && !supports(connection) ? (
                                        <Badge variant="warning">
                                            <TriangleAlertIcon aria-hidden />
                                            {draft.mediaType === 'video' ? 'No video' : 'No photos'}
                                        </Badge>
                                    ) : null}
                                </label>
                            </li>
                        )
                    }}
                />
                {excluded.length ? (
                    <Alert variant="warning" className="mt-4">
                        <TriangleAlertIcon aria-hidden />
                        <AlertTitle>{excluded.map(accountName).join(', ')} won&rsquo;t get this post</AlertTitle>
                        <AlertDescription>
                            {excluded.length === 1 ? 'It doesn’t' : 'They don’t'} support{excluded.length === 1 ? 's' : ''}{' '}
                            {draft.mediaType === 'video' ? 'video' : 'photo'} posts. Switch the media type or untick {excluded.length === 1 ? 'it' : 'them'}.
                        </AlertDescription>
                    </Alert>
                ) : null}
            </SectionCard>

            <SectionCard step={2} title="Media" description="Pick from your library, or a folder to fill the video, thumbnail and photos at once.">
                <div className="flex flex-col gap-4">
                    <ToggleGroup
                        aria-label="Media type"
                        value={[draft.mediaType]}
                        onValueChange={(value) => {
                            const next = value[0] as 'video' | 'photos' | undefined
                            if (next) update({ mediaType: next })
                        }}
                    >
                        <ToggleGroupItem value="video" aria-label="Video">
                            <FilmIcon aria-hidden /> Video
                        </ToggleGroupItem>
                        <ToggleGroupItem value="photos" aria-label="Photos">
                            <ImagesIcon aria-hidden /> Photos
                        </ToggleGroupItem>
                    </ToggleGroup>

                    {draft.mediaType === 'video' ? (
                        <div className="flex flex-wrap items-center gap-4">
                            {video ? (
                                <span className="w-48 overflow-hidden rounded-control border border-border">
                                    <MediaPreview type="video" url={video.url} alt={video.name} />
                                </span>
                            ) : null}
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="text-label text-foreground">{video?.name ?? 'No video selected'}</span>
                                {video ? (
                                    <span className="text-meta">
                                        {formatDuration(video.durationSeconds)} · {video.orientation ?? 'unknown orientation'}
                                    </span>
                                ) : null}
                            </div>
                            <Button variant="secondary" leftIcon={<FilmIcon aria-hidden />} onClick={() => setPicker({ kind: 'video' })}>
                                {video ? 'Change Video' : 'Choose Video'}
                            </Button>
                        </div>
                    ) : null}

                    {draft.mediaType === 'video' ? (
                        <div className="flex items-center gap-2 rounded-surface border border-border bg-background p-4">
                            {sharedThumb ? (
                                <span className="w-16 shrink-0 overflow-hidden rounded-control border border-border">
                                    <MediaPreview type="image" url={sharedThumb.url} alt={sharedThumb.name} />
                                </span>
                            ) : (
                                <ImageIcon aria-hidden className="size-4 text-muted-foreground" />
                            )}
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="text-label text-foreground">Thumbnail for all accounts</span>
                                <span className="truncate text-meta">
                                    {draft.thumbnailAll ? (sharedThumb?.name ?? 'Loading…') : 'None — platform default'}
                                    {draft.thumbnailAll && thumbTargets.length
                                        ? ` · ${thumbTargets.filter((c) => !draft.thumbnails[c.id]).length} of ${thumbTargets.length} account${thumbTargets.length === 1 ? '' : 's'} use it`
                                        : ''}
                                    {targets.length && !thumbTargets.length ? ' · none of the selected accounts take a thumbnail' : ''}
                                </span>
                            </span>
                            {draft.thumbnailAll ? (
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Remove the thumbnail for all accounts"
                                    onClick={() => update({ thumbnailAll: null })}
                                >
                                    <XIcon aria-hidden />
                                </Button>
                            ) : null}
                            <Button variant="secondary" size="sm" onClick={() => setPicker({ kind: 'thumbnail', connectionId: null })}>
                                {draft.thumbnailAll ? 'Change' : 'Choose'}
                            </Button>
                        </div>
                    ) : null}

                    {draft.mediaType === 'photos' ? (
                        <div className="flex flex-col gap-4">
                            {photos.length ? (
                                <ol className="flex flex-wrap gap-2" aria-label="Carousel order (drag to reorder)">
                                    {photos.map((photo, index) => (
                                        <li
                                            key={photo.id}
                                            draggable
                                            onDragStart={() => setDragId(photo.id)}
                                            onDragEnd={() => setDragId(null)}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                                e.preventDefault()
                                                if (!dragId) return
                                                update((d) => {
                                                    const ids = d.photoIds.filter((id) => id !== dragId)
                                                    ids.splice(index, 0, dragId)
                                                    return { photoIds: ids }
                                                })
                                            }}
                                            className={cn(
                                                'relative w-32 cursor-grab overflow-hidden rounded-control border border-border',
                                                dragId === photo.id && 'opacity-50'
                                            )}
                                        >
                                            <MediaPreview type="image" url={photo.url} alt={photo.name} />
                                            <span className="absolute top-1 start-1 flex items-center gap-1 rounded-control bg-popover px-1 text-mono">
                                                <GripVerticalIcon aria-hidden className="size-3" />
                                                {index + 1}
                                            </span>
                                            <span className="absolute top-1 end-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    aria-label={`Remove ${photo.name}`}
                                                    onClick={() => update((d) => ({ photoIds: d.photoIds.filter((id) => id !== photo.id) }))}
                                                >
                                                    <XIcon aria-hidden />
                                                </Button>
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            ) : null}
                            <div>
                                <Button variant="secondary" leftIcon={<ImagesIcon aria-hidden />} onClick={() => setPicker({ kind: 'photos' })}>
                                    {photos.length ? 'Change Photos' : 'Choose Photos'}
                                </Button>
                            </div>
                        </div>
                    ) : null}
                    {mediaIssue && selected.length ? <p className="text-meta">{mediaIssue}.</p> : null}
                    {batchIssues.map((issue) => (
                        <Alert key={issue.message} variant="destructive">
                            <AlertDescription>{issue.message}</AlertDescription>
                        </Alert>
                    ))}
                </div>
            </SectionCard>

            {targets.length ? (
                <SectionCard
                    step={3}
                    title="AI sources (optional)"
                    description="Pick a social JSON and/or subtitles to let AI write titles and captions. Nothing is posted automatically."
                    action={
                        <Tooltip>
                            {/* Disabled buttons get no pointer events, so the span carries the tooltip (and focus while disabled). */}
                            <TooltipTrigger render={<span tabIndex={aiEnabled && aiTargets.length ? undefined : 0} />}>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Fill all titles and descriptions with AI"
                                    disabled={!aiEnabled || aiTargets.length === 0}
                                    loading={aiBusy}
                                    onClick={generateAll}
                                >
                                    <SparklesIcon aria-hidden />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {!aiEnabled
                                    ? 'Choose a social JSON or subtitles first'
                                    : aiTargets.length === 0
                                      ? 'None of the selected accounts have AI fields'
                                      : `Fill titles and descriptions for ${aiTargets.length} account${aiTargets.length === 1 ? '' : 's'}`}
                            </TooltipContent>
                        </Tooltip>
                    }
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        {(
                            [
                                { kind: 'json', label: 'Social JSON', icon: BracesIcon, id: draft.aiJsonId },
                                { kind: 'subtitle', label: 'Subtitles', icon: CaptionsIcon, id: draft.aiSubtitleId },
                            ] as const
                        ).map(({ kind, label, icon: Icon, id }) => (
                            <div key={kind} className="flex items-center gap-2 rounded-surface border border-border bg-background p-4">
                                <Icon aria-hidden className="size-4 text-muted-foreground" />
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="text-label text-foreground">{label}</span>
                                    <span className="truncate text-meta">{id ? (cache[id]?.name ?? 'Loading…') : 'None'}</span>
                                </span>
                                {id ? (
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Remove ${label}`}
                                        onClick={() => update(kind === 'json' ? { aiJsonId: null } : { aiSubtitleId: null })}
                                    >
                                        <XIcon aria-hidden />
                                    </Button>
                                ) : null}
                                <Button variant="secondary" size="sm" onClick={() => setAiPicker(kind)}>
                                    {id ? 'Change' : 'Choose'}
                                </Button>
                            </div>
                        ))}
                    </div>
                </SectionCard>
            ) : null}

            {targets.length ? (
                <section className="flex flex-col gap-4" aria-labelledby="cards-heading">
                    <h2 id="cards-heading" className="text-section-title text-foreground">
                        <span className="text-mono text-muted-foreground">4.</span> Post details
                    </h2>
                    {targets.map((connection) => {
                        const caps = capsFor(connection)!
                        const textField = textFieldOf(caps)
                        const thumbId = thumbnailOf(connection.id)
                        const ownThumb = Boolean(draft.thumbnails[connection.id])
                        return (
                            <AccountCard
                                key={connection.id}
                                connection={connection}
                                capabilities={caps}
                                mediaType={draft.mediaType}
                                input={draft.inputs[connection.id] ?? {}}
                                issues={issues.filter((i) => i.socialConnectionId === connection.id)}
                                video={video}
                                thumbnail={thumbId ? (cache[thumbId] ?? null) : null}
                                photos={photos}
                                override={draft.photoOverrides[connection.id]}
                                copySources={targets
                                    .filter((c) => c.id !== connection.id)
                                    .map((c) => ({ id: c.id, name: `${accountName(c)} (${capsFor(c)?.label})` }))}
                                onChange={(field, value) =>
                                    update((d) => ({
                                        inputs: { ...d.inputs, [connection.id]: { ...d.inputs[connection.id], [field]: value } },
                                    }))
                                }
                                onPickThumbnail={() => setPicker({ kind: 'thumbnail', connectionId: connection.id })}
                                thumbnailInherited={!ownThumb && Boolean(draft.thumbnailAll)}
                                onResetThumbnail={
                                    ownThumb
                                        ? () =>
                                              update((d) => {
                                                  const thumbnails = { ...d.thumbnails }
                                                  delete thumbnails[connection.id]
                                                  return { thumbnails }
                                              })
                                        : undefined
                                }
                                aiFor={aiFor(connection)}
                                instruction={draft.accountInstructions[connection.id] ?? ''}
                                onInstructionChange={
                                    aiFieldsOf(connection).length
                                        ? (value) =>
                                              update((d) => ({
                                                  accountInstructions: { ...d.accountInstructions, [connection.id]: value },
                                              }))
                                        : undefined
                                }
                                headerChip={
                                    <ScheduleChip
                                        schedule={scheduleOf(connection.id)}
                                        inherited={!draft.schedules?.[connection.id] && Boolean(draft.scheduleAll)}
                                    />
                                }
                                scheduleSlot={
                                    <ScheduleControl
                                        value={draft.schedules?.[connection.id] ?? null}
                                        fallback={draft.scheduleAll}
                                        error={issues.find((i) => i.socialConnectionId === connection.id && i.field === 'schedule')?.message}
                                        onChange={(next) =>
                                            update((d) => {
                                                const schedules = { ...(d.schedules ?? {}) }
                                                if (next) schedules[connection.id] = next
                                                else delete schedules[connection.id]
                                                return { schedules }
                                            })
                                        }
                                    />
                                }
                                onOverride={(ids) =>
                                    update((d) => {
                                        const next = { ...d.photoOverrides }
                                        if (ids) next[connection.id] = ids
                                        else delete next[connection.id]
                                        return { photoOverrides: next }
                                    })
                                }
                                onCopyFrom={(sourceId) => {
                                    const source = targets.find((c) => c.id === sourceId)
                                    const sourceField = source ? textFieldOf(capsFor(source)!) : undefined
                                    const value = sourceField ? draft.inputs[sourceId]?.[sourceField.name] : undefined
                                    if (!textField || typeof value !== 'string') return toast.error('Nothing to copy')
                                    const text = textField.maxLength ? value.slice(0, textField.maxLength) : value
                                    update((d) => ({
                                        inputs: { ...d.inputs, [connection.id]: { ...d.inputs[connection.id], [textField.name]: text } },
                                    }))
                                    toast.success(`Copied text into ${textField.label}`)
                                }}
                            />
                        )
                    })}
                </section>
            ) : null}

            <MediaPickerDialog
                open={picker?.kind === 'video'}
                onOpenChange={(open) => !open && setPicker(null)}
                type="video"
                title="Choose a video"
                initial={video ? [video] : []}
                onPick={([item]) => {
                    if (!item) return
                    remember([item])
                    update({ videoId: item.id, folderId: null })
                }}
                onFolder={(id) => void applyFolder(id)}
            />
            <MediaPickerDialog
                open={picker?.kind === 'photos'}
                onOpenChange={(open) => !open && setPicker(null)}
                type="image"
                multiple
                title="Choose photos"
                initial={photos}
                onPick={(items) => {
                    remember(items)
                    update({ photoIds: items.map((m) => m.id), photoOverrides: {}, folderId: null })
                }}
                onFolder={(id) => void applyFolder(id)}
            />
            <MediaPickerDialog
                open={picker?.kind === 'thumbnail'}
                onOpenChange={(open) => !open && setPicker(null)}
                type="image"
                title="Choose a thumbnail"
                onPick={([item]) => {
                    if (!item || picker?.kind !== 'thumbnail') return
                    remember([item])
                    const id = picker.connectionId
                    update((d) => (id ? { thumbnails: { ...d.thumbnails, [id]: item.id } } : { thumbnailAll: item.id }))
                }}
            />

            <MediaPickerDialog
                open={aiPicker !== null}
                onOpenChange={(open) => !open && setAiPicker(null)}
                type={aiPicker ?? 'json'}
                title={aiPicker === 'subtitle' ? 'Choose subtitles' : 'Choose a social JSON'}
                onPick={([item]) => {
                    if (!item) return
                    remember([item])
                    update(aiPicker === 'subtitle' ? { aiSubtitleId: item.id } : { aiJsonId: item.id })
                }}
                onFolder={async (folderId) => {
                    const folder = await utils.folders.get.fetch({ folderId })
                    const role = aiPicker === 'subtitle' ? 'subtitles' : 'social_json'
                    const { items } = await utils.folders.items.fetch({ folderId, role })
                    const item = items.find((i) => i.isPrimary) ?? items[0]
                    if (!item) return toast.error(`${folder.name} has no ${aiPicker === 'subtitle' ? 'subtitles' : 'social JSON'}`)
                    remember([
                        {
                            id: item.media.id,
                            name: item.media.name,
                            type: item.media.type,
                            status: item.media.status,
                            url: item.media.previewUrl,
                            orientation: item.media.orientation,
                            durationSeconds: item.media.durationSeconds,
                            width: item.media.width,
                            height: item.media.height,
                        },
                    ])
                    update(aiPicker === 'subtitle' ? { aiSubtitleId: item.mediaId } : { aiJsonId: item.mediaId })
                }}
            />
            <ConfirmDialog
                open={pendingFill !== null}
                onOpenChange={(open) => {
                    if (open || !pendingFill) return
                    if (replaced.current) {
                        replaced.current = false
                        setPendingFill(null)
                        return
                    }
                    // "Keep Mine": fill only the fields the user hadn't edited.
                    const kept = new Set(pendingFill.edited.map((f) => `${f.connectionId}:${f.field}`))
                    applyFills(
                        pendingFill.fills.filter((f) => !kept.has(`${f.connectionId}:${f.field}`)),
                        pendingFill.issues
                    )
                    setPendingFill(null)
                }}
                title="Replace text you edited?"
                description={
                    <span className="flex flex-col gap-2">
                        <span>AI wrote new text for fields you changed:</span>
                        <span>{pendingFill?.edited.map(fieldLabel).join(', ')}</span>
                    </span>
                }
                cancelLabel="Keep Mine"
                confirmLabel="Replace"
                onConfirm={() => {
                    if (!pendingFill) return
                    applyFills(pendingFill.fills, pendingFill.issues)
                    replaced.current = true
                }}
            />

            <ScheduleDialog
                open={scheduleAllOpen}
                onOpenChange={setScheduleAllOpen}
                title="Schedule all"
                description="Cards without their own time post at this time. Cards with their own time keep it."
                initial={draft.scheduleAll}
                confirmLabel="Set time"
                onConfirm={(schedule) => {
                    update({ scheduleAll: schedule })
                    setScheduleAllOpen(false)
                }}
            />
            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={scheduledCount ? `${submitLabel}?` : `Post to ${targets.length} account${targets.length === 1 ? '' : 's'}?`}
                description={
                    <span className="flex flex-col gap-2">
                        <span className="flex flex-col">
                            {targets.map((c) => {
                                const s = scheduleOf(c.id)
                                return (
                                    <span key={c.id}>
                                        {`${accountName(c)} (${capsFor(c)?.label}) — ${s ? formatScheduled(s.at, s.timezone) : 'now'}`}
                                    </span>
                                )
                            })}
                        </span>
                        {billed.length ? (
                            <span>X posts are billed per post on your X API plan.</span>
                        ) : null}
                        <span>Publishing continues in the background — you can close this tab.</span>
                    </span>
                }
                confirmLabel={submitLabel}
                onConfirm={async () => {
                    try {
                        const result = await publish.mutateAsync(payload)
                        clearDraft()
                        setDraft(emptyDraft())
                        toast.success(
                            result.replayed ? 'Already posted — showing that batch' : scheduledCount ? 'Scheduled' : 'Publishing started'
                        )
                        router.push(`/posts/batch/${result.batchId}`)
                    } catch {
                        toast.error('Fix the highlighted issues, then post again')
                    }
                }}
            />
        </div>
    )
}
