import {
    CableIcon,
    ImageIcon,
    LayoutDashboardIcon,
    ListIcon,
    PenSquareIcon,
    SettingsIcon,
    type LucideIcon,
} from 'lucide-react'

export type NavSubItem = { title: string; href: string }
export type NavItem = {
    title: string
    href: string
    icon: LucideIcon
    /** Sub-pages shown under the item (expanded sidebar only). */
    children?: NavSubItem[]
}
export type NavGroup = { label: string; items: NavItem[] }

/** Sidebar navigation — single source for sidebar items and page titles. */
export const navGroups: NavGroup[] = [
    {
        label: 'Main',
        items: [
            {
                title: 'Dashboard',
                href: '/dashboard',
                icon: LayoutDashboardIcon,
            },
            { title: 'Compose', href: '/compose', icon: PenSquareIcon },
            { title: 'Posts', href: '/posts', icon: ListIcon },
            {
                title: 'Media',
                href: '/media',
                icon: ImageIcon,
                children: [
                    { title: 'Library', href: '/media' },
                    { title: 'Folders', href: '/media/folders' },
                ],
            },
        ],
    },
    {
        label: 'Setup',
        items: [
            { title: 'Connections', href: '/connections', icon: CableIcon },
            { title: 'Settings', href: '/settings', icon: SettingsIcon },
        ],
    },
]

export const navItems = navGroups.flatMap((group) => group.items)

export function navItemForPath(pathname: string): NavItem | undefined {
    return navItems.find(
        (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
    )
}

/**
 * Active sub-item: the most specific child whose href matches, so
 * /media/folders/123 → Folders and /media/abc → Library.
 */
export function activeChildHref(item: NavItem, pathname: string): string | undefined {
    return (item.children ?? [])
        .filter((child) => pathname === child.href || pathname.startsWith(`${child.href}/`))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href
}
