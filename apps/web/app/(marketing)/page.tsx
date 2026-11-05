import Link from 'next/link'
import { Show, SignUpButton } from '@clerk/nextjs'

import { Button } from '~/components/ui/button'

export default function HomePage() {
    return (
        <section className="mx-auto flex w-full max-w-page flex-1 flex-col items-start justify-center gap-6 px-4 py-16 md:px-6">
            <h1 className="max-w-form text-page-title text-balance text-foreground">
                Write once. Fannout everywhere.
            </h1>
            <p className="max-w-form text-sm text-muted-foreground">
                Compose a post, attach your media and publish it to every
                connected channel from one place.
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <Show when="signed-out">
                    <SignUpButton mode="modal">
                        <Button variant="primary" size="lg">
                            Get Started
                        </Button>
                    </SignUpButton>
                </Show>
                <Show when="signed-in">
                    <Button
                        variant="primary"
                        size="lg"
                        nativeButton={false}
                        render={<Link href="/dashboard" />}
                    >
                        Open Dashboard
                    </Button>
                </Show>
            </div>
        </section>
    )
}
