import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'

import { Button } from '~/components/ui/button'

/** Clerk modal sign-in / sign-up when signed out; user menu when signed in. */
export function AuthControls() {
    return (
        <>
            <Show when="signed-out">
                <SignInButton mode="modal">
                    <Button variant="ghost">Sign In</Button>
                </SignInButton>
                <SignUpButton mode="modal">
                    <Button variant="primary">Sign Up</Button>
                </SignUpButton>
            </Show>
            <Show when="signed-in">
                <UserButton />
            </Show>
        </>
    )
}
