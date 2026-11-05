import { clerkMiddleware } from '@clerk/nextjs/server'

/**
 * Clerk session handling for every request. Route protection lives in the
 * layouts (resource-based, per Clerk guidance): see app/(app)/layout.tsx.
 */
export default clerkMiddleware()

export const config = {
    matcher: [
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        '/(api|trpc)(.*)',
        '/__clerk/(.*)',
    ],
}
