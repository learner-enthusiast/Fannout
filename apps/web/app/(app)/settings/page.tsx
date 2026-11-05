import type { Metadata } from 'next'

import { ComingSoon } from '~/components/layout/coming-soon'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
    return (
        <ComingSoon
            title="Settings"
            description="Your account and workspace preferences."
        />
    )
}
