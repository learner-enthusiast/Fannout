'use client'

import { FolderIcon, FolderPlusIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '~/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { guessRole, type FolderRole, type MediaType, type Orientation } from '~/lib/media-roles'
import { cn } from '~/lib/utils'
import { trpc } from '~/trpc/client'

import { RoleSelect } from './role-select'

export type PickedMedia = {
    id: string
    name: string
    type: MediaType
    orientation: Orientation | null
    originalFilename: string | null
}

type Assignment = { mediaId: string; role: FolderRole; label: string }

/** Role (and label for "other") per selected media, pre-guessed. */
export function RoleAssignments({
    media,
    value,
    onChange,
    onRemove,
}: {
    media: PickedMedia[]
    value: Assignment[]
    onChange: (next: Assignment[]) => void
    /** Shows a remove button per row. */
    onRemove?: (mediaId: string) => void
}) {
    const set = (mediaId: string, patch: Partial<Assignment>) =>
        onChange(value.map((a) => (a.mediaId === mediaId ? { ...a, ...patch } : a)))
    return (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {media.map((item) => {
                const assignment = value.find((a) => a.mediaId === item.id)
                if (!assignment) return null
                return (
                    <li key={item.id} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-label text-foreground">{item.name}</span>
                        <RoleSelect
                            type={item.type}
                            value={assignment.role}
                            aria-label={`Role for ${item.name}`}
                            onChange={(role) => set(item.id, { role })}
                        />
                        {assignment.role === 'other' ? (
                            <Input
                                size="sm"
                                aria-label={`Label for ${item.name}`}
                                placeholder="Label"
                                value={assignment.label}
                                maxLength={100}
                                onChange={(event) => set(item.id, { label: event.target.value })}
                            />
                        ) : null}
                        {onRemove ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove ${item.name}`}
                                onClick={() => onRemove(item.id)}
                            >
                                <XIcon aria-hidden />
                            </Button>
                        ) : null}
                    </li>
                )
            })}
        </ul>
    )
}

export const initialAssignments = (media: PickedMedia[]): Assignment[] =>
    media.map((item) => ({ mediaId: item.id, role: guessRole(item), label: '' }))

export const toItems = (assignments: Assignment[]) =>
    assignments.map(({ mediaId, role, label }) => ({
        mediaId,
        role,
        ...(role === 'other' ? { label: label.trim() } : {}),
    }))

export const missingLabel = (assignments: Assignment[]) =>
    assignments.some((a) => a.role === 'other' && !a.label.trim())

/** "Add to folder" from the library: existing folder or a new one, role per item. */
export function AddToFolderDialog({
    media,
    open,
    onOpenChange,
    onDone,
}: {
    media: PickedMedia[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onDone: () => void
}) {
    const utils = trpc.useUtils()
    const [tab, setTab] = useState<'existing' | 'new'>('existing')
    const [query, setQuery] = useState('')
    const q = useDebouncedValue(query.trim())
    const [folderId, setFolderId] = useState<string | null>(null)
    const [newName, setNewName] = useState('')
    const [assignments, setAssignments] = useState<Assignment[]>([])

    useEffect(() => {
        if (open) setAssignments(initialAssignments(media))
    }, [open, media])

    const folders = trpc.folders.list.useQuery(
        { limit: 20, ...(q ? { q } : {}) },
        { enabled: open && tab === 'existing', staleTime: 0 }
    )

    const finish = (folder: { id: string; name: string }) => {
        void utils.folders.list.invalidate()
        void utils.media.get.invalidate()
        toast.success(`Added to ${folder.name}`, {
            action: { label: 'Open', onClick: () => window.location.assign(`/media/folders/${folder.id}`) },
        })
        onOpenChange(false)
        onDone()
    }
    const add = trpc.folders.addItems.useMutation({ onSuccess: finish })
    const create = trpc.folders.create.useMutation({ onSuccess: finish })

    const canSubmit =
        assignments.length > 0 &&
        !missingLabel(assignments) &&
        (tab === 'existing' ? Boolean(folderId) : Boolean(newName.trim()))

    const submit = () => {
        const items = toItems(assignments)
        if (tab === 'existing' && folderId) add.mutate({ folderId, items })
        else create.mutate({ name: newName.trim(), items })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Add to folder</DialogTitle>
                    <DialogDescription>
                        {media.length} item{media.length === 1 ? '' : 's'} selected. Check the role of each one.
                    </DialogDescription>
                </DialogHeader>
                <Tabs value={tab} onValueChange={(v) => setTab(v as 'existing' | 'new')}>
                    <TabsList>
                        <TabsTrigger value="existing">Existing Folder</TabsTrigger>
                        <TabsTrigger value="new">New Folder</TabsTrigger>
                    </TabsList>
                    <TabsContent value="existing" className="flex flex-col gap-2 pt-4">
                        <Input
                            size="sm"
                            type="search"
                            aria-label="Search folders"
                            placeholder="Search folders"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        {folders.isPending ? (
                            <Skeleton className="h-24 w-full" />
                        ) : (folders.data?.items.length ?? 0) === 0 ? (
                            <p className="py-4 text-center text-meta">
                                No folders{q ? ' match' : ' yet'}. Create a new one instead.
                            </p>
                        ) : (
                            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Folders">
                                {folders.data?.items.map((folder) => (
                                    <li key={folder.id}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={folderId === folder.id}
                                            onClick={() => setFolderId(folder.id)}
                                            className={cn(
                                                'flex w-full items-center gap-2 rounded-control px-2 py-2 text-start outline-none transition-colors duration-fast ease-out hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-card',
                                                folderId === folder.id && 'bg-accent'
                                            )}
                                        >
                                            <FolderIcon aria-hidden className="size-4 text-muted-foreground" />
                                            <span className="min-w-0 flex-1 truncate text-foreground">{folder.name}</span>
                                            <span className="text-mono text-muted-foreground">{folder.itemCount}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </TabsContent>
                    <TabsContent value="new" className="pt-4">
                        <FormField label="Folder name" required>
                            {(p) => (
                                <Input
                                    {...p}
                                    value={newName}
                                    maxLength={120}
                                    placeholder="e.g. graphql-vs-rest"
                                    onChange={(event) => setNewName(event.target.value)}
                                />
                            )}
                        </FormField>
                    </TabsContent>
                </Tabs>
                <section className="flex flex-col gap-2" aria-label="Roles">
                    <h3 className="text-label text-foreground">Roles</h3>
                    <RoleAssignments media={media} value={assignments} onChange={setAssignments} />
                </section>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        leftIcon={<FolderPlusIcon aria-hidden />}
                        disabled={!canSubmit}
                        loading={add.isPending || create.isPending}
                        onClick={submit}
                    >
                        {tab === 'new' ? 'Create Folder' : 'Add to Folder'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function NewFolderButton() {
    return (
        <Button variant="secondary" nativeButton={false} leftIcon={<FolderPlusIcon aria-hidden />} render={<Link href="/media/folders/new" />}>
            New Folder
        </Button>
    )
}
