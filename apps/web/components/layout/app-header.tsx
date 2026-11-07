'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SidebarTrigger } from '~/components/ui/sidebar'
import { Separator } from '~/components/ui/separator'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import { Logo } from '~/components/layout/logo'
import { navItemForPath } from '~/components/layout/nav'
import { ThemeToggle } from '~/components/layout/theme-toggle'

/**
 * Sticky top bar. `withSidebar` adds the sidebar trigger (app routes only).
 * The page title is derived from the nav config unless `title` is given.
 * `authSlot` receives <AuthControls/> (a server-safe Clerk island).
 * `toolsSlot` holds app-only header tools (uploads indicator, notifications).
 */
export function AppHeader({
    withSidebar = false,
    title,
    authSlot,
    toolsSlot,
}: {
    withSidebar?: boolean
    title?: React.ReactNode
    authSlot?: React.ReactNode
    toolsSlot?: React.ReactNode
}) {
    const pathname = usePathname()
    const pageTitle =
        title ?? (withSidebar ? navItemForPath(pathname)?.title : undefined)

    return (
        <header className="sticky top-0 z-30 flex h-14 min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
            {withSidebar ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <SidebarTrigger
                                size="icon"
                                aria-label="Toggle sidebar"
                            />
                        }
                    />
                    <TooltipContent side="bottom">
                        Toggle sidebar <kbd className="text-mono">Ctrl/⌘ B</kbd>
                    </TooltipContent>
                </Tooltip>
            ) : null}
            <Link
                href={withSidebar ? '/dashboard' : '/'}
                aria-label="Fannout home"
                className="rounded-control"
            >
                <Logo compact />
            </Link>
            {pageTitle ? (
                <>
                    <Separator
                        orientation="vertical"
                        className="mx-2 my-4 hidden sm:block"
                    />
                    <span className="hidden truncate text-label text-muted-foreground sm:block">
                        {pageTitle}
                    </span>
                </>
            ) : null}
            <div className="ms-auto flex shrink-0 items-center gap-2">
                {toolsSlot}
                <ThemeToggle />
                {authSlot}
            </div>
        </header>
    )
}
