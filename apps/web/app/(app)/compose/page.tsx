import type { Metadata } from 'next'

import { ComposeView } from '~/components/compose/compose-view'
import { PageHeader } from '~/components/layout/page-header'

export const metadata: Metadata = { title: 'Compose' }

export default function ComposePage() {
    return (
        <>
            <PageHeader title="Compose" description="Write once, then tune each account's post." />
            <ComposeView />
        </>
    )
}
