'use client'

import { FolderPlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
    initialAssignments,
    missingLabel,
    RoleAssignments,
    toItems,
    type PickedMedia,
} from '~/components/media/add-to-folder-dialog'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '~/components/ui/card'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { Textarea } from '~/components/ui/textarea'
import { normalizeTRPCError } from '~/lib/error'
import type { FolderRole } from '~/lib/media-roles'
import { trpc } from '~/trpc/client'

type Assignment = { mediaId: string; role: FolderRole; label: string }

/**
 * New folder. With `fromJson`, it is prefilled from that social-package
 * JSON's suggestion; the user reviews roles (or drops items) before creating.
 */
export function NewFolderForm({ fromJson }: { fromJson?: string }) {
    const router = useRouter()
    const utils = trpc.useUtils()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [nameError, setNameError] = useState<string>()
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [removed, setRemoved] = useState<Set<string>>(new Set())

    const json = trpc.media.get.useQuery({ mediaId: fromJson ?? '' }, { enabled: Boolean(fromJson), staleTime: 0 })
    const suggestion = json.data?.folderSuggestion ?? null
    const ids = useMemo(() => suggestion?.items.map((item) => item.mediaId) ?? [], [suggestion])
    const details = trpc.useQueries((t) => ids.map((mediaId) => t.media.get({ mediaId })))

    const picked: PickedMedia[] = details
        .map((query) => query.data)
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .filter((m) => !removed.has(m.id))
        .map((m) => ({ id: m.id, name: m.name, type: m.type, orientation: m.orientation, originalFilename: m.originalFilename }))
    const loadingDetails = details.some((query) => query.isPending)

    // Prefill once the suggestion + its media have loaded.
    const [prefilled, setPrefilled] = useState(false)
    useEffect(() => {
        if (prefilled || !suggestion || loadingDetails) return
        setName(suggestion.folderName)
        const guessed = initialAssignments(picked)
        setAssignments(
            guessed.map((a) => ({ ...a, role: suggestion.items.find((i) => i.mediaId === a.mediaId)?.role ?? a.role }))
        )
        setPrefilled(true)
    }, [prefilled, suggestion, loadingDetails, picked])

    const create = trpc.folders.create.useMutation({
        onSuccess: (folder) => {
            void utils.folders.list.invalidate()
            toast.success(`Folder ${folder.name} created`)
            router.push(`/media/folders/${folder.id}`)
        },
        onError: (error) => {
            const { code, message } = normalizeTRPCError(error)
            if (code === 'CONFLICT') setNameError(message)
        },
    })

    const kept = assignments.filter((a) => !removed.has(a.mediaId))
    const submit = (event: React.FormEvent) => {
        event.preventDefault()
        if (!name.trim()) return setNameError('Enter a folder name')
        create.mutate({
            name: name.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(kept.length ? { items: toItems(kept) } : {}),
        })
    }

    if (fromJson && (json.isPending || (suggestion && loadingDetails))) {
        return <Skeleton className="h-64 w-full max-w-form rounded-surface" />
    }

    return (
        <form onSubmit={submit} className="flex max-w-form flex-col gap-8" noValidate>
            {fromJson && !suggestion ? (
                <Alert variant="warning">
                    <AlertTitle>No folder suggestion</AlertTitle>
                    <AlertDescription>
                        That file isn&rsquo;t a processed social-package JSON. You can still create a folder by hand.
                    </AlertDescription>
                </Alert>
            ) : null}
            <div className="flex flex-col gap-4">
                <FormField label="Name" required error={nameError}>
                    {(p) => (
                        <Input
                            {...p}
                            value={name}
                            maxLength={120}
                            onChange={(event) => {
                                setName(event.target.value)
                                setNameError(undefined)
                            }}
                            onBlur={() => !name.trim() && setNameError('Enter a folder name')}
                        />
                    )}
                </FormField>
                <FormField label="Description" helper="Optional." counter={{ value: description, limit: 2000 }}>
                    {(p) => <Textarea {...p} value={description} onChange={(event) => setDescription(event.target.value)} />}
                </FormField>
            </div>

            {picked.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Files from the social package</CardTitle>
                        <CardDescription>Check each role. Remove anything that doesn&rsquo;t belong.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                        <RoleAssignments
                            media={picked}
                            value={assignments}
                            onChange={setAssignments}
                            onRemove={(id) => setRemoved((current) => new Set(current).add(id))}
                        />
                    </CardContent>
                </Card>
            ) : null}

            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => router.back()}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    leftIcon={<FolderPlusIcon aria-hidden />}
                    loading={create.isPending}
                    disabled={missingLabel(kept)}
                >
                    Create Folder
                </Button>
            </div>
        </form>
    )
}
