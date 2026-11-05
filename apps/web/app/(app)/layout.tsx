import { auth } from '@clerk/nextjs/server'

import { devAuthBypass } from '~/lib/dev-auth'
import { AppShell } from '~/components/layout/app-shell'

/** Signed-in app. Clerk protects every route in this group. */
export default async function AppLayout({
    children,
}: {
    children: React.ReactNode
}) {
    if (!devAuthBypass) await auth.protect()
    return <AppShell>{children}</AppShell>
}
