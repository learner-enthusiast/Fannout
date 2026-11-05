import type { Metadata } from 'next'

import { ComingSoon } from '~/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Media' }

export default function MediaPage() {
    return (
        <ComingSoon
            title="Media"
            description="Images and videos you can attach to posts."
        />
    )
}
