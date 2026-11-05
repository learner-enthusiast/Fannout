import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ThemePreview } from '~/components/theme-preview/theme-preview'

export const metadata: Metadata = {
    title: 'Theme preview',
    robots: { index: false, follow: false },
}

/** Dev-only design-system page. 404 in production builds. */
export default function ThemePreviewPage() {
    if (process.env.NODE_ENV === 'production') notFound()
    return <ThemePreview />
}
