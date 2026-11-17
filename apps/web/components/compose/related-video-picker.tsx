'use client'

import { format } from 'date-fns'
import { FilmIcon, LinkIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { InfiniteList } from '~/components/infinite-list'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { Switch } from '~/components/ui/switch'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'
import { normalizeTRPCError } from '~/lib/error'
import { trpc } from '~/trpc/client'

export type RelatedVideo = { videoId: string; title: string; watchNext?: boolean }

/**
 * "Related video" for a YouTube video post: pick from the channel's uploads (10 per page,
 * infinite scroll) or paste a YouTube link. YouTube's API can't set it, so the choice becomes a
 * follow-up task after publishing — and, for long-form videos, an optional "Watch next" line.
 */
export function RelatedVideoPicker({
    id,
    socialConnectionId,
    value,
    onChange,
    short,
}: {
    id: string
    socialConnectionId: string
    value: RelatedVideo | undefined
    onChange: (value: RelatedVideo | undefined) => void
    /** The post publishes as a Short: description links aren't clickable there, so no "Watch next". */
    short: boolean
}) {
    const utils = trpc.useUtils()
    const [open, setOpen] = useState(false)
    const [filter, setFilter] = useState('')
    const [link, setLink] = useState('')
    const [checking, setChecking] = useState(false)
    const [root, setRoot] = useState<HTMLDivElement | null>(null)
    const uploadsQuery = trpc.platforms.youtubeUploads.useInfiniteQuery(
        { socialConnectionId },
        infiniteOptions({ enabled: open, staleTime: 5 * 60 * 1000, retry: false })
    )
    const uploads = useInfiniteList(uploadsQuery)
    const needle = filter.trim().toLowerCase()
    const shown = needle ? uploads.items.filter((video) => video.title.toLowerCase().includes(needle)) : uploads.items

    const choose = (video: { videoId: string; title: string }) => {
        onChange({ videoId: video.videoId, title: video.title, watchNext: value?.watchNext ?? true })
        setOpen(false)
        setLink('')
    }
    const applyLink = async () => {
        if (!link.trim()) return
        setChecking(true)
        try {
            choose(await utils.platforms.youtubeVideo.fetch({ socialConnectionId, url: link.trim() }))
        } catch (error) {
            toast.error(normalizeTRPCError(error).message)
        } finally {
            setChecking(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <FilmIcon aria-hidden className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-foreground">{value ? value.title : 'None'}</span>
                {value ? (
                    <Button variant="ghost" size="icon-sm" aria-label="Remove the related video" onClick={() => onChange(undefined)}>
                        <XIcon aria-hidden />
                    </Button>
                ) : null}
                <Button id={id} variant="secondary" size="sm" onClick={() => setOpen(true)}>
                    {value ? 'Change' : 'Choose Video'}
                </Button>
            </div>
            {value && !short ? (
                <div className="flex items-center justify-between gap-4">
                    <label className="text-meta" htmlFor={`${id}-watch-next`}>
                        Add a “Watch next” link to the description
                    </label>
                    <Switch
                        id={`${id}-watch-next`}
                        checked={value.watchNext !== false}
                        onCheckedChange={(next) => onChange({ ...value, watchNext: next })}
                    />
                </div>
            ) : null}
            {value && short ? <p className="text-meta">This is a Short: links in the description aren’t clickable, so no “Watch next” line is added.</p> : null}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Choose a related video</DialogTitle>
                        <DialogDescription>From this channel’s uploads, newest first. Or paste a YouTube link.</DialogDescription>
                    </DialogHeader>
                    <Input
                        size="sm"
                        type="search"
                        aria-label="Filter loaded videos by title"
                        placeholder="Filter by title"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                    <div ref={setRoot} className="max-h-80 overflow-y-auto">
                        <InfiniteList
                            list={{ ...uploads, items: shown }}
                            root={root}
                            getKey={(video) => video.videoId}
                            className="flex flex-col gap-1"
                            skeleton={<Skeleton className="h-14 w-full rounded-control" />}
                            empty={<p className="py-8 text-center text-meta">{needle ? 'No loaded video matches. Scroll to load more, or paste its link.' : 'This channel has no uploads yet.'}</p>}
                            renderItem={(video) => (
                                <li>
                                    <button
                                        type="button"
                                        onClick={() => choose(video)}
                                        className="flex w-full items-center gap-4 rounded-control p-2 text-start outline-none transition-colors duration-fast ease-out hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-card"
                                    >
                                        <span className="flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
                                            {video.thumbnailUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail, not optimisable
                                                <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                                            ) : (
                                                <FilmIcon aria-hidden className="size-4 text-muted-foreground" />
                                            )}
                                        </span>
                                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                                            <span className="truncate text-label text-foreground">{video.title}</span>
                                            <span className="text-meta">{video.publishedAt ? format(new Date(video.publishedAt), 'PP') : 'Not published'}</span>
                                        </span>
                                    </button>
                                </li>
                            )}
                        />
                    </div>
                    <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                            e.preventDefault()
                            void applyLink()
                        }}
                    >
                        <LinkIcon aria-hidden className="size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                            <Input
                                size="sm"
                                aria-label="Paste a YouTube URL"
                                placeholder="Paste a YouTube URL"
                                value={link}
                                onChange={(e) => setLink(e.target.value)}
                            />
                        </div>
                        <Button type="submit" variant="secondary" size="sm" loading={checking} disabled={!link.trim()}>
                            Use Link
                        </Button>
                    </form>
                    <DialogFooter>
                        <Button variant="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
