import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '~/components/ui/empty'

/**
 * EmptyState — what a list/page shows when there is nothing yet.
 * 24px icon + title + ONE sentence + actions (at most one primary, placed on
 * the right; put secondary actions before it).
 */
export function EmptyState({
    icon: Icon,
    title,
    description,
    actions,
}: {
    icon: LucideIcon
    title: string
    /** One sentence. */
    description: React.ReactNode
    actions?: React.ReactNode
}) {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
                <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
            {actions ? (
                <EmptyContent>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        {actions}
                    </div>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}
