import { cookies } from 'next/headers'

import { SidebarProvider } from '~/components/ui/sidebar'
import { SIDEBAR_COOKIE_NAME } from '~/lib/sidebar-state'
import { AppFooter } from '~/components/layout/app-footer'
import { AppHeader } from '~/components/layout/app-header'
import { AppSidebar } from '~/components/layout/app-sidebar'
import { AuthControls } from '~/components/layout/auth-controls'
import { SkipLink } from '~/components/layout/skip-link'

/**
 * Signed-in app frame: sidebar + (header, main#content, footer).
 * Sidebar open/collapsed state is restored from its cookie on the server so
 * there is no layout jump on load.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
    const cookieStore = await cookies()
    const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== 'false'

    return (
        <SidebarProvider defaultOpen={defaultOpen}>
            <SkipLink />
            <AppSidebar />
            <div className="flex min-h-svh min-w-0 flex-1 flex-col">
                <AppHeader withSidebar authSlot={<AuthControls />} />
                <main
                    id="content"
                    tabIndex={-1}
                    className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 py-6 outline-none md:px-6 md:py-8"
                >
                    {children}
                </main>
                <AppFooter />
            </div>
        </SidebarProvider>
    )
}
