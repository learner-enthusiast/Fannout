import { auth } from '@clerk/nextjs/server'

import { devAuthBypass } from '~/lib/dev-auth'
import { AppShell } from '~/components/layout/app-shell'
import { UploadProvider } from '~/components/uploads/upload-provider'

/**
 * Signed-in app. Clerk protects every route in this group. UploadProvider is
 * mounted once here so background uploads survive route changes.
 */
export default async function AppLayout({
    children,
}: {
    children: React.ReactNode
}) {
    if (!devAuthBypass) await auth.protect()
    return (
        <UploadProvider>
            <AppShell>{children}</AppShell>
        </UploadProvider>
    )
}
