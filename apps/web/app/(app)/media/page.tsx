import type { Metadata } from 'next'

import { PageHeader } from '~/components/layout/page-header'
import { NewFolderButton } from '~/components/media/add-to-folder-dialog'
import { MediaLibrary } from '~/components/media/media-library'
import { UploadButton } from '~/components/uploads/upload-dialog'

export const metadata: Metadata = { title: 'Media' }

export default async function MediaPage({
    searchParams,
}: {
    searchParams: Promise<{ upload?: string }>
}) {
    const { upload } = await searchParams
    return (
        <>
            <PageHeader
                title="Media"
                description="Videos, images, subtitles and social JSON. Group them into folders."
                actions={
                    <>
                        <NewFolderButton />
                        <UploadButton defaultOpen={upload === '1'} />
                    </>
                }
            />
            <MediaLibrary />
        </>
    )
}
