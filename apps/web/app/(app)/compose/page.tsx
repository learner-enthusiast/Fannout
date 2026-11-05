import type { Metadata } from 'next'

import { ComingSoon } from '~/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Compose' }

export default function ComposePage() {
    return (
        <ComingSoon
            title="Compose"
            description="Write a post once and send it to every channel."
        />
    )
}
