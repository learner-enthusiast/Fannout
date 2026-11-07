import type { Metadata } from 'next'

import { PageHeader } from '~/components/layout/page-header'
import { NewFolderButton } from '~/components/media/add-to-folder-dialog'
import { MediaLibrary, UploadButton } from '~/components/media/media-library'

export const metadata: Metadata = { title: 'Media' }

export default function MediaPage() {
    return (
        <>
            <PageHeader
                title="Media"
                description="Videos, images, subtitles and social JSON. Group them into folders."
                actions={
                    <>
                        <NewFolderButton />
                        <UploadButton />
                    </>
                }
            />
            <MediaLibrary />
        </>
    )
}
