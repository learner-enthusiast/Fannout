import { HourglassIcon } from 'lucide-react'

import { Card, CardContent } from '~/components/ui/card'
import { EmptyState } from '~/components/ui/empty-state'
import { PageHeader } from '~/components/layout/page-header'

/** Placeholder body for nav destinations that aren't built yet. */
export function ComingSoon({
    title,
    description,
}: {
    title: string
    description: string
}) {
    return (
        <>
            <PageHeader title={title} description={description} />
            <Card>
                <CardContent>
                    <EmptyState
                        icon={HourglassIcon}
                        title="Coming soon"
                        description={`${title} is being built and will appear here.`}
                    />
                </CardContent>
            </Card>
        </>
    )
}
