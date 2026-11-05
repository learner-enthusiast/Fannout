import type { Metadata } from 'next'

import { ComingSoon } from '~/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
    return (
        <ComingSoon
            title="Dashboard"
            description="An overview of your posts and channels."
        />
    )
}
