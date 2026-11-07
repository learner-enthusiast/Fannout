import type { Metadata } from 'next'

import { FolderDetailView } from '~/components/folders/folder-detail'

export const metadata: Metadata = { title: 'Folder' }

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <FolderDetailView folderId={id} />
}
