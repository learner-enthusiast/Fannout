import type { Metadata } from 'next'

import { PageHeader } from '~/components/layout/page-header'
import { BatchList, ComposeButton } from '~/components/posts/batch-list'

export const metadata: Metadata = { title: 'Posts' }

export default function PostsPage() {
    return (
        <>
            <PageHeader title="Posts" description="Everything you've sent from the composer, newest first." actions={<ComposeButton />} />
            <BatchList />
        </>
    )
}
