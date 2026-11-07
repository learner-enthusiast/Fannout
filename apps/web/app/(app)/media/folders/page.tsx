import type { Metadata } from 'next'

import { FolderList, NewFolderPrimaryButton } from '~/components/folders/folder-list'
import { PageHeader } from '~/components/layout/page-header'

export const metadata: Metadata = { title: 'Folders' }

export default function FoldersPage() {
    return (
        <>
            <PageHeader
                title="Folders"
                description="Each folder groups one video's cuts, trailers, thumbnails, subtitles and social copy."
                actions={<NewFolderPrimaryButton />}
            />
            <FolderList />
        </>
    )
}
