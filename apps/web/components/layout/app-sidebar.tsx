'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SparklesIcon } from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarRail,
    useSidebar,
} from '~/components/ui/sidebar'
import { activeChildHref, navGroups } from '~/components/layout/nav'

/**
 * App navigation. Expanded ↔ icon rail (Ctrl/⌘+B, state in a cookie);
 * off-canvas sheet on mobile. Items come from components/layout/nav.ts.
 */
export function AppSidebar() {
    const pathname = usePathname()
    const { isMobile, setOpenMobile } = useSidebar()

    return (
        <Sidebar collapsible="icon">
            <SidebarContent className="pt-2">
                <nav aria-label="Primary" className="flex flex-col">
                    {navGroups.map((group) => (
                        <SidebarGroup key={group.label}>
                            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {group.items.map((item) => {
                                        const active =
                                            pathname === item.href ||
                                            pathname.startsWith(`${item.href}/`)
                                        return (
                                            <SidebarMenuItem key={item.href}>
                                                <SidebarMenuButton
                                                    isActive={active}
                                                    tooltip={item.title}
                                                    render={
                                                        <Link
                                                            href={item.href}
                                                            aria-current={
                                                                active
                                                                    ? 'page'
                                                                    : undefined
                                                            }
                                                            onClick={() => {
                                                                if (isMobile)
                                                                    setOpenMobile(
                                                                        false
                                                                    )
                                                            }}
                                                        />
                                                    }
                                                >
                                                    <item.icon aria-hidden />
                                                    <span>{item.title}</span>
                                                </SidebarMenuButton>
                                                {item.children ? (
                                                    <SidebarMenuSub>
                                                        {item.children.map((child) => {
                                                            const childActive =
                                                                activeChildHref(item, pathname) === child.href
                                                            return (
                                                                <SidebarMenuSubItem key={child.href}>
                                                                    <SidebarMenuSubButton
                                                                        isActive={childActive}
                                                                        render={
                                                                            <Link
                                                                                href={child.href}
                                                                                aria-current={childActive ? 'page' : undefined}
                                                                                onClick={() => {
                                                                                    if (isMobile) setOpenMobile(false)
                                                                                }}
                                                                            />
                                                                        }
                                                                    >
                                                                        <span>{child.title}</span>
                                                                    </SidebarMenuSubButton>
                                                                </SidebarMenuSubItem>
                                                            )
                                                        })}
                                                    </SidebarMenuSub>
                                                ) : null}
                                            </SidebarMenuItem>
                                        )
                                    })}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    ))}
                </nav>
            </SidebarContent>
            <SidebarFooter className="p-4 group-data-[collapsible=icon]:hidden">
                <div className="flex items-center justify-between gap-2 text-meta text-muted-foreground">
                    <span>Plan</span>
                    <Badge variant="outline">
                        <SparklesIcon aria-hidden />
                        Free
                    </Badge>
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
