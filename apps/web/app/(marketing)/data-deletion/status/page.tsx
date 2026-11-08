import { SearchXIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { z } from 'zod'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { EmptyState } from '~/components/ui/empty-state'
import { StatusBadge } from '~/components/ui/status-badge'
import { env } from '~/env'
import { apiOrigin } from '~/lib/api-origin'

/**
 * Public status page for Meta (Facebook / Threads) data-deletion requests — the `url`
 * returned to Meta's data-deletion callback. Shows provider, status and dates only;
 * no personal data.
 */
export const metadata: Metadata = {
    title: 'Data deletion status',
    description: 'Check the status of a data deletion request made from Facebook or Threads.',
    robots: { index: false },
}
export const dynamic = 'force-dynamic'

const StatusSchema = z.object({
    provider: z.enum(['facebook', 'threads']),
    status: z.enum(['received', 'processing', 'completed', 'no_data']),
    requestedAt: z.string(),
    completedAt: z.string().nullable(),
})

const PROVIDER = { facebook: 'Facebook', threads: 'Threads' } as const
const BADGE = {
    received: { status: 'pending', label: 'Received' },
    processing: { status: 'processing', label: 'Processing' },
    completed: { status: 'ready', label: 'Completed' },
    no_data: { status: 'pending', label: 'No data found' },
} as const

async function loadStatus(code: string) {
    if (!/^[A-Za-z0-9]{16}$/.test(code)) return null
    const origin = env.BASE_URL ?? apiOrigin()
    if (!origin) return null
    try {
        const res = await fetch(`${origin}/webhooks/meta/data-deletion/status?code=${encodeURIComponent(code)}`, { cache: 'no-store' })
        if (!res.ok) return null
        const parsed = StatusSchema.safeParse(await res.json())
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '—')

export default async function DataDeletionStatusPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
    const { code = '' } = await searchParams
    const status = await loadStatus(code)

    return (
        <main className="mx-auto flex w-full max-w-form flex-col gap-8 px-4 py-12 md:px-6">
            <h1 className="text-page-title text-foreground">Data deletion status</h1>
            {status ? (
                <Card>
                    <CardHeader>
                        <CardTitle>{PROVIDER[status.provider]} data deletion request</CardTitle>
                        <CardDescription>
                            Confirmation code <span className="text-mono">{code}</span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <dl className="grid grid-cols-2 gap-4">
                            <dt className="text-meta">Status</dt>
                            <dd>
                                <StatusBadge status={BADGE[status.status].status} label={BADGE[status.status].label} />
                            </dd>
                            <dt className="text-meta">Requested</dt>
                            <dd className="text-body">{formatDate(status.requestedAt)}</dd>
                            <dt className="text-meta">Completed</dt>
                            <dd className="text-body">{formatDate(status.completedAt)}</dd>
                        </dl>
                    </CardContent>
                </Card>
            ) : (
                <EmptyState icon={SearchXIcon} title="Request not found" description="Check the link from Facebook or Threads and try again." />
            )}
            <p className="text-meta">
                Learn what we delete in our{' '}
                <Link href="/privacy#data-deletion" className="text-link">
                    privacy policy
                </Link>
                .
            </p>
        </main>
    )
}
