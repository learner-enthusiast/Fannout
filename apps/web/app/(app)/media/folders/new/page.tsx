import type { Metadata } from 'next'

import { NewFolderForm } from '~/components/folders/new-folder-form'
import { PageHeader } from '~/components/layout/page-header'
import { BackButton } from '~/components/media/media-detail'

export const metadata: Metadata = { title: 'New folder' }

export default async function NewFolderPage({
    searchParams,
}: {
    searchParams: Promise<{ fromJson?: string | string[] }>
}) {
    const { fromJson } = await searchParams
    const jsonId = typeof fromJson === 'string' && /^[0-9a-f-]{36}$/i.test(fromJson) ? fromJson : undefined
    return (
        <>
            <PageHeader
                title="New folder"
                description={jsonId ? 'Review the folder suggested by your social package.' : undefined}
                actions={<BackButton href="/media/folders" label="Back to Folders" />}
            />
            <NewFolderForm fromJson={jsonId} />
        </>
    )
}
