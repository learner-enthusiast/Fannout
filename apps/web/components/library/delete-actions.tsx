'use client'

import { useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { EllipsisVerticalIcon, Trash2Icon } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { Button } from '~/components/ui/button'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { normalizeTRPCError } from '~/lib/error'
import { removeFromInfiniteCache, restoreSnapshot, updateCache, type Snapshot } from '~/lib/optimistic'
import { trpc } from '~/trpc/client'

// ---------------------------------------------------------------------------
// Pending deletes (cards fade out and lock their menu while in flight)
// ---------------------------------------------------------------------------

const pending = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const setPending = (id: string, on: boolean) => {
    if (on) pending.add(id)
    else pending.delete(id)
    emit()
}
/** True while this item's delete is in flight. */
export function useIsDeleting(id: string) {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l)
            return () => listeners.delete(l)
        },
        () => pending.has(id),
        () => false
    )
}

const FADE_MS = 150
const fade = () =>
    new Promise<void>((resolve) =>
        setTimeout(resolve, typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : FADE_MS)
    )

// ---------------------------------------------------------------------------
// Card menu
// ---------------------------------------------------------------------------

/** Kebab menu for a card (top-right; visible on hover/focus, always on touch). Delete is last. */
export function CardMenu({ label, disabled, onDelete }: { label: string; disabled?: boolean; onDelete: () => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`} disabled={disabled} />}
            >
                <EllipsisVerticalIcon aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <Trash2Icon aria-hidden />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/** Wrapper classes for the menu slot inside a `group` card. */
export const cardMenuSlot =
    'absolute top-2 end-2 rounded-control bg-popover opacity-0 shadow-float transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100'

// ---------------------------------------------------------------------------
// Media delete (optimistic)
// ---------------------------------------------------------------------------

type Target = { id: string; name: string }
type WithId = { id: string }
type FolderItem = { mediaId: string }

export function useDeleteMedia(options: { onDeleted?: () => void } = {}) {
    const queryClient = useQueryClient()
    const utils = trpc.useUtils()
    const [target, setTarget] = useState<Target | null>(null)
    const detail = trpc.media.get.useQuery({ mediaId: target?.id ?? '' }, { enabled: Boolean(target), staleTime: 0, retry: false })
    const folderIds = detail.data?.folders.map((f) => f.folderId) ?? []

    const remove = trpc.media.delete.useMutation({
        onMutate: async ({ mediaId }) => {
            const name = target?.name ?? 'media'
            setPending(mediaId, true)
            const keys = {
                library: getQueryKey(trpc.media.list),
                items: getQueryKey(trpc.folders.items),
                search: getQueryKey(trpc.search.unified),
                folder: getQueryKey(trpc.folders.get),
                folders: getQueryKey(trpc.folders.list),
            }
            await Promise.all(Object.values(keys).map((queryKey) => queryClient.cancelQueries({ queryKey })))
            await fade()
            const inFolder = new Set(folderIds)
            const snapshots: Snapshot[] = [
                removeFromInfiniteCache<WithId>(queryClient, keys.library, (m) => m.id === mediaId),
                removeFromInfiniteCache<FolderItem>(queryClient, keys.items, (i) => i.mediaId === mediaId),
                updateCache<{ folders: unknown[]; media: WithId[] }>(queryClient, keys.search, (d) => ({ ...d, media: d.media.filter((m) => m.id !== mediaId) })),
                updateCache<{ id: string; itemCount: number }>(queryClient, keys.folder, (d) =>
                    inFolder.has(d.id) ? { ...d, itemCount: Math.max(0, d.itemCount - 1) } : d
                ),
                updateCache<{ pages: { items: { id: string; itemCount: number }[] }[] }>(queryClient, keys.folders, (d) => ({
                    ...d,
                    pages: d.pages.map((p) => ({
                        ...p,
                        items: p.items.map((f) => (inFolder.has(f.id) ? { ...f, itemCount: Math.max(0, f.itemCount - 1) } : f)),
                    })),
                })),
            ]
            return { snapshots, name }
        },
        onError: (error, { mediaId }, context) => {
            if (context) restoreSnapshot(queryClient, ...context.snapshots)
            setPending(mediaId, false)
            toast.error(normalizeTRPCError(error).message)
        },
        onSuccess: (_result, _vars, context) => {
            toast.success(`Deleted “${context?.name ?? 'media'}”`, { duration: 4000 })
            options.onDeleted?.()
        },
        onSettled: (_r, _e, { mediaId }) => {
            setPending(mediaId, false)
            void utils.media.list.invalidate()
            void utils.folders.items.invalidate()
            void utils.folders.get.invalidate()
            void utils.folders.list.invalidate()
            void utils.search.unified.invalidate()
        },
    })

    const description = (() => {
        const parts = ['This removes the file from your library and storage.']
        if (detail.data?.folders.length) parts.push(`It will also be removed from: ${[...new Set(detail.data.folders.map((f) => f.name))].join(', ')}.`)
        if (detail.data?.inUseByPosts) parts.push('Published posts are not affected.')
        return parts.join(' ')
    })()

    const dialog = (
        <ConfirmDialog
            open={target !== null}
            onOpenChange={(open) => !open && setTarget(null)}
            title={`Delete “${target?.name ?? ''}”?`}
            description={detail.isPending ? 'Checking where it’s used…' : description}
            confirmLabel="Delete"
            onConfirm={() => {
                if (!target) return
                // Fire and close: the card fades out right away; errors restore it.
                remove.mutate({ mediaId: target.id })
            }}
        />
    )
    return { request: (media: Target) => !pending.has(media.id) && setTarget(media), dialog }
}

// ---------------------------------------------------------------------------
// Folder delete (optimistic) — never deletes the media inside
// ---------------------------------------------------------------------------

export function useDeleteFolder(options: { onDeleted?: () => void } = {}) {
    const queryClient = useQueryClient()
    const utils = trpc.useUtils()
    const [target, setTarget] = useState<(Target & { itemCount: number }) | null>(null)

    const remove = trpc.folders.delete.useMutation({
        onMutate: async ({ folderId }) => {
            const name = target?.name ?? 'folder'
            setPending(folderId, true)
            const folders = getQueryKey(trpc.folders.list)
            const search = getQueryKey(trpc.search.unified)
            await Promise.all([queryClient.cancelQueries({ queryKey: folders }), queryClient.cancelQueries({ queryKey: search })])
            await fade()
            return {
                name,
                snapshots: [
                    removeFromInfiniteCache<WithId>(queryClient, folders, (f) => f.id === folderId),
                    updateCache<{ folders: WithId[]; media: unknown[] }>(queryClient, search, (d) => ({ ...d, folders: d.folders.filter((f) => f.id !== folderId) })),
                ],
            }
        },
        onError: (error, { folderId }, context) => {
            if (context) restoreSnapshot(queryClient, ...context.snapshots)
            setPending(folderId, false)
            toast.error(normalizeTRPCError(error).message)
        },
        onSuccess: (_result, _vars, context) => {
            toast.success(`Deleted “${context?.name ?? 'folder'}”`, { duration: 4000 })
            options.onDeleted?.()
        },
        onSettled: (_r, _e, { folderId }) => {
            setPending(folderId, false)
            void utils.folders.list.invalidate()
            void utils.search.unified.invalidate()
            void utils.media.get.invalidate()
        },
    })

    const dialog = (
        <ConfirmDialog
            open={target !== null}
            onOpenChange={(open) => !open && setTarget(null)}
            title={`Delete folder “${target?.name ?? ''}”?`}
            description={`The ${target?.itemCount ?? 0} file${target?.itemCount === 1 ? '' : 's'} inside stay in your library.`}
            confirmLabel="Delete"
            onConfirm={() => {
                if (target) remove.mutate({ folderId: target.id })
            }}
        />
    )
    return { request: (folder: Target & { itemCount: number }) => !pending.has(folder.id) && setTarget(folder), dialog }
}
