import type { Metadata } from 'next'

import { PageHeader } from '~/components/layout/page-header'
import { ApiKeysSettings } from '~/components/settings/api-keys'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
    return (
        <>
            <PageHeader title="Settings" description="Your account and API access." />
            <ApiKeysSettings />
        </>
    )
}
