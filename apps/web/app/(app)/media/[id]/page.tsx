import type { Metadata } from 'next'

import { MediaDetailView } from '~/components/media/media-detail'

export const metadata: Metadata = { title: 'Media' }

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <MediaDetailView mediaId={id} />
}
