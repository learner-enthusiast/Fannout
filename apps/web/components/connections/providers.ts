import {
    AtSignIcon,
    FacebookIcon,
    InstagramIcon,
    LinkedinIcon,
    TwitterIcon,
    YoutubeIcon,
    type LucideIcon,
} from 'lucide-react'

export type ProviderSlug = 'linkedin' | 'x' | 'youtube' | 'facebook' | 'threads' | 'instagram'
export type ProviderValue = 'LINKEDIN' | 'X' | 'YOUTUBE' | 'FACEBOOK' | 'THREADS' | 'INSTAGRAM'

export const providers: {
    slug: ProviderSlug
    value: ProviderValue
    name: string
    description: string
    icon: LucideIcon
}[] = [
    {
        slug: 'linkedin',
        value: 'LINKEDIN',
        name: 'LinkedIn',
        description: 'Your personal LinkedIn profile.',
        icon: LinkedinIcon,
    },
    {
        slug: 'x',
        value: 'X',
        name: 'X',
        description: 'Your X (Twitter) account.',
        icon: TwitterIcon,
    },
    {
        slug: 'youtube',
        value: 'YOUTUBE',
        name: 'YouTube',
        description: 'One or more YouTube channels on a Google account.',
        icon: YoutubeIcon,
    },
    {
        slug: 'facebook',
        value: 'FACEBOOK',
        name: 'Facebook',
        description: 'Facebook Pages you manage.',
        icon: FacebookIcon,
    },
    {
        slug: 'threads',
        value: 'THREADS',
        name: 'Threads',
        description: 'Your Threads profile.',
        icon: AtSignIcon,
    },
    {
        slug: 'instagram',
        value: 'INSTAGRAM',
        name: 'Instagram',
        description: 'Instagram Business or Creator accounts you share.',
        icon: InstagramIcon,
    },
]

/** User-facing text for the `reason` the API puts on failed callbacks. */
export const failureMessages: Record<string, string> = {
    access_denied: 'You cancelled the connection.',
    expired_state: 'The connection took too long. Please try again.',
    invalid_state: 'This connection link is no longer valid. Please try again.',
    session_mismatch:
        'The connection was started in a different browser or session. Please try again.',
    insufficient_scope:
        'Some required permissions were not granted. Please allow all requested permissions.',
    no_account:
        'No account was found. YouTube needs a channel and Facebook needs a Page you manage.',
    not_configured: 'This provider is not set up yet.',
    id_token_invalid: 'The provider response could not be verified.',
}

/** Reason texts that differ per provider (looked up before `failureMessages`). */
export const providerFailureMessages: Partial<Record<ProviderSlug, Record<string, string>>> = {
    instagram: {
        no_account:
            'No Instagram professional account was shared. It must be a Business or Creator account inside the business portfolio you selected.',
        insufficient_scope:
            'Instagram permissions were missing. Reconnect and allow every requested permission, including content publishing.',
    },
}

export const defaultFailureMessage = 'The account could not be connected. Please try again.'
