import { notFound } from 'next/navigation'

import { AppShell } from '~/components/layout/app-shell'

/** Dev-only tools (no auth). Every route here 404s in production. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
    if (process.env.NODE_ENV === 'production') notFound()
    return <AppShell>{children}</AppShell>
}
