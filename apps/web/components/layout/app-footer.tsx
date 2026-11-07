import Link from 'next/link'

import pkg from '~/package.json'

const links = [
    { label: 'Docs', href: '#docs' },
    { label: 'Status', href: '#status' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '#terms' },
]

/** Footer: copyright, version, placeholder legal/docs links. */
export function AppFooter() {
    return (
        <footer className="border-t border-border px-4 py-4 md:px-6">
            <div className="flex flex-col gap-2 text-meta text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>
                    © {new Date().getFullYear()} Fannout ·{' '}
                    <span className="text-mono">v{pkg.version}</span>
                </p>
                <nav aria-label="Footer">
                    <ul className="flex flex-wrap gap-4">
                        {links.map((link) => (
                            <li key={link.label}>
                                <Link
                                    href={link.href}
                                    className="rounded-control hover:text-foreground hover:underline"
                                >
                                    {link.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            </div>
        </footer>
    )
}
