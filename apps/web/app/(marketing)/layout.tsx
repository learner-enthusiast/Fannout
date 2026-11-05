import { AppFooter } from '~/components/layout/app-footer'
import { AppHeader } from '~/components/layout/app-header'
import { AuthControls } from '~/components/layout/auth-controls'
import { SkipLink } from '~/components/layout/skip-link'

/** Public pages: header + footer, no sidebar. */
export default function MarketingLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex min-h-svh flex-col">
            <SkipLink />
            <AppHeader authSlot={<AuthControls />} />
            <main
                id="content"
                tabIndex={-1}
                className="flex flex-1 flex-col outline-none"
            >
                {children}
            </main>
            <AppFooter />
        </div>
    )
}
