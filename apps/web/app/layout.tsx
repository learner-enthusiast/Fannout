import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { ClerkProvider } from '@clerk/nextjs'
import { shadcn } from '@clerk/ui/themes'

import './globals.css'
import { cn } from '~/lib/utils'
import { brand } from '~/lib/brand'
import { GlobalProviders } from '~/providers/global'

const geistSans = localFont({
    src: './fonts/GeistVF.woff',
    variable: '--font-geist-sans',
    display: 'swap',
})
const geistMono = localFont({
    src: './fonts/GeistMonoVF.woff',
    variable: '--font-geist-mono',
    display: 'swap',
})

export const metadata: Metadata = {
    title: { default: 'Fannout', template: '%s · Fannout' },
    description: 'Fannout — write once, publish to every channel.',
    applicationName: 'Fannout',
}

export const viewport: Viewport = {
    // Themes are class-based (not OS-based), so advertise the default (dark).
    themeColor: brand.dark.background,
    colorScheme: 'dark light',
}

/** Clerk modal/user menu themed from our CSS variables (dark + beige). */
const clerkAppearance = {
    theme: shadcn,
    variables: {
        colorBackground: 'var(--popover)',
        colorForeground: 'var(--popover-foreground)',
        colorInput: 'var(--background)',
        colorInputForeground: 'var(--foreground)',
        colorSuccess: 'var(--success)',
        colorWarning: 'var(--warning)',
        colorDanger: 'var(--destructive)',
        colorRing: 'var(--ring)',
        borderRadius: 'var(--radius-control)',
        fontFamily: 'var(--font-sans)',
        fontSize: '14px',
    },
    elements: {
        cardBox: 'shadow-float border border-border rounded-surface',
        popoverBox: 'shadow-float border border-border rounded-surface',
        formButtonPrimary:
            'bg-primary text-primary-foreground hover:bg-primary-hover',
    },
}

export default function RootLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <html
            lang="en"
            suppressHydrationWarning
            className={cn(geistSans.variable, geistMono.variable)}
        >
            <body>
                <ClerkProvider appearance={clerkAppearance}>
                    <GlobalProviders>{children}</GlobalProviders>
                </ClerkProvider>
            </body>
        </html>
    )
}
