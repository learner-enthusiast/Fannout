'use client'

import { format } from 'date-fns'
import { FolderIcon, FolderPlusIcon, Trash2Icon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '~/components/layout/page-header'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { useDeleteMedia } from '~/components/library/delete-actions'
import { Skeleton } from '~/components/ui/skeleton'
import { StatusBadge } from '~/components/ui/status-badge'
import { normalizeTRPCError } from '~/lib/error'
import { formatBytes, formatDuration } from '~/lib/media-format'
import { ROLE_LABEL } from '~/lib/media-roles'
import { trpc } from '~/trpc/client'

import { InlineRename } from './inline-rename'
import { OrientationBadge, TypeBadge } from './media-badges'
import { MediaPreview } from './media-preview'

const DONE = new Set(['ready', 'failed'])

/** Client-side so it can be used from server pages (Button uses hooks). */
export function BackButton({ href = '/media', label = 'Back to Media' }: { href?: string; label?: string }) {
    return (
        <Button variant="secondary" nativeButton={false} render={<Link href={href} />}>
            {label}
        </Button>
    )
}

export function MediaDetailView({ mediaId }: { mediaId: string }) {
    const router = useRouter()
    const query = trpc.media.get.useQuery(
        { mediaId },
        {
            staleTime: 0,
            // Keep polling while Inngest is still processing the upload.
            refetchInterval: (q) => (q.state.data && !DONE.has(q.state.data.status) ? 3000 : false),
        }
    )
    const deleteMedia = useDeleteMedia({ onDeleted: () => router.push('/media') })

    if (query.isPending) {
        return (
            <div className="flex flex-col gap-8" aria-busy>
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="aspect-video w-full max-w-3xl rounded-surface" />
            </div>
        )
    }
    if (query.isError) {
        const { code, message } = normalizeTRPCError(query.error)
        return (
            <>
                <PageHeader title="Media" actions={<BackButton />} />
                <Alert variant="destructive">
                    <AlertTitle>{code === 'NOT_FOUND' ? 'Media not found' : 'Could not load this media'}</AlertTitle>
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            </>
        )
    }

    const media = query.data
    const rows: [string, string][] = [
        ['File', media.originalFilename ?? '—'],
        ['Size', formatBytes(media.sizeBytes)],
        ...(media.width && media.height ? ([['Dimensions', `${media.width} × ${media.height}`]] as [string, string][]) : []),
        ...(media.type === 'video'
            ? ([
                  ['Duration', formatDuration(media.durationSeconds)],
                  ['Frame rate', media.fps ? `${media.fps} fps` : '—'],
                  ['Codecs', [media.codec?.video, media.codec?.audio].filter(Boolean).join(' / ') || '—'],
              ] as [string, string][])
            : []),
        ...(media.subtitle
            ? ([
                  ['Cues', String(media.subtitle.segments)],
                  ['Duration', formatDuration(media.subtitle.durationMs / 1000)],
              ] as [string, string][])
            : []),
        ...(media.type === 'json'
            ? ([['Schema', media.jsonSchema === 'social_package' ? 'Social package' : 'Plain JSON']] as [string, string][])
            : []),
        ['Uploaded', format(new Date(media.createdAt), 'PPp')],
    ]
    const suggestion = media.folderSuggestion

    return (
        <>
            <PageHeader
                title={media.name}
                description={<StatusBadge status={media.status === 'uploaded' ? 'processing' : media.status} />}
                actions={
                    <>
                        <BackButton />
                        <Button
                            variant="destructive"
                            leftIcon={<Trash2Icon aria-hidden />}
                            onClick={() => deleteMedia.request({ id: media.id, name: media.name })}
                        >
                            Delete
                        </Button>
                    </>
                }
            />
            {media.status === 'failed' && media.error ? (
                <Alert variant="destructive">
                    <AlertTitle>Processing failed</AlertTitle>
                    <AlertDescription>{media.error}</AlertDescription>
                </Alert>
            ) : null}
            {suggestion && media.status === 'ready' ? (
                <Alert variant="info">
                    <AlertTitle>Create folder ‘{suggestion.folderName}’?</AlertTitle>
                    <AlertDescription>
                        This social package references {suggestion.items.length - 1} of your uploads.
                    </AlertDescription>
                    <AlertAction>
                        <Button
                            variant="primary"
                            size="sm"
                            nativeButton={false}
                            leftIcon={<FolderPlusIcon aria-hidden />}
                            render={<Link href={`/media/folders/new?fromJson=${media.id}`} />}
                        >
                            Review Folder
                        </Button>
                    </AlertAction>
                </Alert>
            ) : null}
            <div className="grid gap-8 lg:grid-cols-3">
                <Card className="overflow-hidden lg:col-span-2">
                    {media.type === 'video' && media.url ? (
                        <video controls preload="metadata" src={media.url} className="aspect-video w-full bg-background">
                            <track kind="captions" />
                        </video>
                    ) : (
                        <MediaPreview type={media.type} url={media.url} alt={media.name} />
                    )}
                </Card>
                <div className="flex flex-col gap-8">
                    <Card>
                        <CardContent className="flex flex-col gap-4">
                            <InlineRename mediaId={media.id} name={media.name} />
                            <div className="flex flex-wrap gap-2">
                                <TypeBadge type={media.type} />
                                <OrientationBadge orientation={media.orientation} />
                            </div>
                            <dl className="flex flex-col gap-4">
                                {rows.map(([label, value]) => (
                                    <div key={label} className="flex flex-col gap-1">
                                        <dt className="text-meta">{label}</dt>
                                        <dd className="break-all text-foreground">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Folders</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {media.folders.length === 0 ? (
                                <p className="text-meta">Not in any folder yet.</p>
                            ) : (
                                <ul className="flex flex-col gap-2">
                                    {media.folders.map((folder) => (
                                        <li key={`${folder.folderId}-${folder.role}`} className="flex items-center gap-2">
                                            <FolderIcon aria-hidden className="size-4 text-muted-foreground" />
                                            <Link href={`/media/folders/${folder.folderId}`} className="min-w-0 flex-1 truncate text-link hover:underline">
                                                {folder.name}
                                            </Link>
                                            <span className="text-meta">{ROLE_LABEL[folder.role]}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
            {deleteMedia.dialog}
        </>
    )
}
