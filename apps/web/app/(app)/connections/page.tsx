import type { Metadata } from 'next'
import { Suspense } from 'react'

import { ConnectionsView } from '~/components/connections/connections-view'
import { PageHeader } from '~/components/layout/page-header'

export const metadata: Metadata = { title: 'Connections' }

export default function ConnectionsPage() {
    return (
        <>
            <PageHeader
                title="Connections"
                description="The channels Fannout publishes to."
            />
            {/* useSearchParams (OAuth result) needs a Suspense boundary. */}
            <Suspense>
                <ConnectionsView />
            </Suspense>
        </>
    )
}
