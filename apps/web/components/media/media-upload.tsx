'use client'

import { UploadIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '~/components/ui/button'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import { Dropzone } from '~/components/uploads/dropzone'
import { UploadList } from '~/components/uploads/upload-list'
import { useUploads } from '~/components/uploads/upload-provider'
import { formatBytes, mediaKind, nameFromFilename, UPLOAD_ACCEPT } from '~/lib/media-format'
import { TYPE_LABEL } from '~/lib/media-roles'

type Staged = { id: string; file: File; name: string }

/**
 * Pick files → optionally rename each → start. Uploads then run in the
 * background queue, so the user can leave right away.
 */
export function MediaUpload({
    onStarted,
    showQueue = true,
}: {
    /** Called after files join the queue (the dialog closes itself here). */
    onStarted?: () => void
    /** The page lists uploads below; the dialog leaves that to the header indicator. */
    showQueue?: boolean
} = {}) {
    const { enqueue, items } = useUploads()
    const [staged, setStaged] = useState<Staged[]>([])

    const stage = (files: File[]) =>
        setStaged((current) => [
            ...current,
            ...files.map((file) => ({ id: crypto.randomUUID(), file, name: nameFromFilename(file.name) })),
        ])

    const start = () => {
        enqueue(staged.map(({ file, name }) => ({ file, name })))
        toast.success(staged.length === 1 ? 'Upload started' : `${staged.length} uploads started`, {
            description: 'You can keep using Fannout while they finish.',
        })
        setStaged([])
        onStarted?.()
    }

    return (
        <div className="flex max-w-form flex-col gap-8">
            <Dropzone
                accept={UPLOAD_ACCEPT}
                title="Drop videos, images, subtitles (SRT/VTT) or social JSON here"
                helper="Uploads continue while Fannout is open."
                onFiles={stage}
            />

            {staged.length > 0 ? (
                <section className="flex flex-col gap-4" aria-labelledby="staged-heading">
                    <h2 id="staged-heading" className="text-section-title text-foreground">
                        Ready to upload
                    </h2>
                    <ul className="flex flex-col gap-4">
                        {staged.map((entry) => {
                            const kind = mediaKind(entry.file)?.kind
                            return (
                                <li key={entry.id} className="flex items-end gap-2">
                                    <FormField
                                        label="Name"
                                        className="min-w-0 flex-1"
                                        helper={`${entry.file.name} · ${kind ? TYPE_LABEL[kind] : 'Unsupported'} · ${formatBytes(entry.file.size)}`}
                                    >
                                        {(p) => (
                                            <Input
                                                {...p}
                                                value={entry.name}
                                                maxLength={200}
                                                onChange={(event) =>
                                                    setStaged((current) =>
                                                        current.map((s) =>
                                                            s.id === entry.id ? { ...s, name: event.target.value } : s
                                                        )
                                                    )
                                                }
                                            />
                                        )}
                                    </FormField>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Remove ${entry.file.name}`}
                                        onClick={() => setStaged((current) => current.filter((s) => s.id !== entry.id))}
                                    >
                                        <XIcon aria-hidden />
                                    </Button>
                                </li>
                            )
                        })}
                    </ul>
                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => setStaged([])}>
                            Clear
                        </Button>
                        <Button variant="primary" leftIcon={<UploadIcon aria-hidden />} onClick={start}>
                            {staged.length === 1 ? 'Start Upload' : `Start ${staged.length} Uploads`}
                        </Button>
                    </div>
                </section>
            ) : null}

            {showQueue && items.length > 0 ? (
                <section className="flex flex-col gap-4" aria-labelledby="uploads-heading">
                    <h2 id="uploads-heading" className="text-section-title text-foreground">
                        Uploads
                    </h2>
                    <UploadList />
                </section>
            ) : null}
        </div>
    )
}
