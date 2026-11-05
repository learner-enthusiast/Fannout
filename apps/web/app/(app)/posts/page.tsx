import type { Metadata } from 'next'

import { ComingSoon } from '~/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Posts' }

export default function PostsPage() {
    return (
        <ComingSoon
            title="Posts"
            description="Everything you have scheduled, published or drafted."
        />
    )
}
