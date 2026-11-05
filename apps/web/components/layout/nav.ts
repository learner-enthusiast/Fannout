import {
    CableIcon,
    ImageIcon,
    LayoutDashboardIcon,
    ListIcon,
    PenSquareIcon,
    SettingsIcon,
    type LucideIcon,
} from 'lucide-react'

export type NavItem = { title: string; href: string; icon: LucideIcon }
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
            { title: 'Media', href: '/media', icon: ImageIcon },
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
