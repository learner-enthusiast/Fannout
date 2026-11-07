import type { Metadata } from 'next'

import { BatchDetail } from '~/components/posts/batch-detail'

export const metadata: Metadata = { title: 'Post status' }

export default async function BatchPage({ params }: { params: Promise<{ batchId: string }> }) {
    const { batchId } = await params
    return <BatchDetail batchId={batchId} />
}
