import type { Metadata } from 'next'
import { Suspense } from 'react'

import { DashboardView } from '~/components/dashboard/dashboard-view'
import { Skeleton } from '~/components/ui/skeleton'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
    return (
        // useSearchParams (tab/range in the URL) needs a Suspense boundary.
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <DashboardView />
        </Suspense>
    )
}
