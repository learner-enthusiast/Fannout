import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * Public privacy policy (no auth). Used as the Privacy Policy URL and the
 * Data Deletion Instructions URL (/privacy#data-deletion) for the Meta app,
 * and for the other OAuth providers' consent screens.
 *
 * Replace CONTACT_EMAIL before submitting the app for review.
 */
const CONTACT_EMAIL = 'privacy@example.com'
const LAST_UPDATED = 'November 7, 2026'

export const metadata: Metadata = {
    title: 'Privacy Policy',
    description:
        'How Fannout collects, uses, stores and deletes your data, including data from connected social accounts.',
}

const sections = [
    { id: 'information-we-collect', title: 'Information we collect' },
    { id: 'connected-accounts', title: 'Connected social accounts' },
    { id: 'how-we-use', title: 'How we use information' },
    { id: 'sharing', title: 'How we share information' },
    { id: 'storage-security', title: 'Storage and security' },
    { id: 'retention', title: 'Data retention' },
    { id: 'data-deletion', title: 'Data deletion' },
    { id: 'your-rights', title: 'Your rights' },
    { id: 'children', title: 'Children' },
    { id: 'changes', title: 'Changes to this policy' },
    { id: 'contact', title: 'Contact us' },
]

function Section({
    id,
    title,
    children,
}: {
    id: string
    title: string
    children: React.ReactNode
}) {
    return (
        <section id={id} className="flex scroll-mt-20 flex-col gap-3">
            <h2 className="text-section-title text-foreground">{title}</h2>
            {children}
        </section>
    )
}

function List({ children }: { children: React.ReactNode }) {
    return <ul className="flex list-disc flex-col gap-2 pl-5">{children}</ul>
}

const mail = (
    <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="text-foreground underline underline-offset-2"
    >
        {CONTACT_EMAIL}
    </a>
)

export default function PrivacyPage() {
    return (
        <article className="mx-auto flex w-full max-w-form flex-col gap-10 px-4 py-12 text-sm text-muted-foreground md:px-6">
            <header className="flex flex-col gap-2">
                <h1 className="text-page-title text-balance text-foreground">
                    Privacy Policy
                </h1>
                <p className="text-meta">Last updated: {LAST_UPDATED}</p>
                <p>
                    Fannout (&ldquo;Fannout&rdquo;, &ldquo;we&rdquo;,
                    &ldquo;us&rdquo;) lets you compose a post once and publish
                    it to the social accounts you connect. This policy explains
                    what information we collect, how we use it, and how you can
                    delete it.
                </p>
            </header>

            <nav aria-label="On this page">
                <ol className="flex list-decimal flex-col gap-1 pl-5">
                    {sections.map((s) => (
                        <li key={s.id}>
                            <Link
                                href={`#${s.id}`}
                                className="hover:text-foreground hover:underline"
                            >
                                {s.title}
                            </Link>
                        </li>
                    ))}
                </ol>
            </nav>

            <Section id="information-we-collect" title="Information we collect">
                <List>
                    <li>
                        <strong className="text-foreground">Account information</strong>{' '}
                        — your name, email address and profile image, provided
                        when you sign up or sign in (including through Google or
                        GitHub). Sign-in is handled by our authentication
                        provider, Clerk.
                    </li>
                    <li>
                        <strong className="text-foreground">Content you create</strong>{' '}
                        — posts, captions, schedules and the images or videos you
                        upload to publish.
                    </li>
                    <li>
                        <strong className="text-foreground">Connected account data</strong>{' '}
                        — described in the next section.
                    </li>
                    <li>
                        <strong className="text-foreground">Technical data</strong>{' '}
                        — request logs (such as time, route and status code)
                        used to operate and secure the service.
                    </li>
                </List>
            </Section>

            <Section id="connected-accounts" title="Connected social accounts">
                <p>
                    When you choose to connect an account, you sign in with that
                    platform and approve the permissions it shows you. We only
                    receive what you approve, and we never see your password for
                    that platform.
                </p>
                <List>
                    <li>
                        <strong className="text-foreground">Facebook (Meta)</strong>{' '}
                        — your Facebook user ID and name, and for each Facebook
                        Page you choose to connect: its ID, name, category,
                        profile picture, your role on the Page and a Page access
                        token. Permissions requested: <code>public_profile</code>,{' '}
                        <code>pages_show_list</code>,{' '}
                        <code>pages_read_engagement</code> and{' '}
                        <code>business_management</code> (to list Pages owned
                        through a Meta Business portfolio).
                    </li>
                    <li>
                        <strong className="text-foreground">Threads (Meta)</strong>{' '}
                        — your Threads user ID, username, name and profile
                        picture.
                    </li>
                    <li>
                        <strong className="text-foreground">YouTube (Google)</strong>{' '}
                        — your Google account ID, email, name and picture, and
                        the ID, title, handle and thumbnail of the channels you
                        connect. Fannout&rsquo;s use of information received
                        from Google APIs adheres to the{' '}
                        <a
                            href="https://developers.google.com/terms/api-services-user-data-policy"
                            className="text-foreground underline underline-offset-2"
                        >
                            Google API Services User Data Policy
                        </a>
                        , including the Limited Use requirements.
                    </li>
                    <li>
                        <strong className="text-foreground">LinkedIn</strong> and{' '}
                        <strong className="text-foreground">X</strong> — your
                        account ID, name, username/handle, email (where
                        provided) and profile picture.
                    </li>
                </List>
                <p>
                    For every connected account we store the access and refresh
                    tokens the platform issues, so we can act only on your
                    instructions (for example, publishing a post you
                    scheduled).
                </p>
            </Section>

            <Section id="how-we-use" title="How we use information">
                <List>
                    <li>To create and secure your Fannout account.</li>
                    <li>
                        To show your connected accounts and let you choose where
                        to publish.
                    </li>
                    <li>
                        To publish, schedule and manage the posts you create, on
                        the accounts you select.
                    </li>
                    <li>
                        To operate, debug and protect the service against abuse.
                    </li>
                </List>
                <p>
                    We do not sell your data, use it for advertising, or use
                    data from connected platforms to build profiles or train
                    machine-learning models.
                </p>
            </Section>

            <Section id="sharing" title="How we share information">
                <List>
                    <li>
                        <strong className="text-foreground">With the platforms you choose</strong>{' '}
                        — when you publish, your content is sent to those
                        platforms and becomes subject to their policies.
                    </li>
                    <li>
                        <strong className="text-foreground">With service providers</strong>{' '}
                        that run the service on our behalf: authentication
                        (Clerk), hosting, database and file storage, and
                        background job processing. They may only use the data to
                        provide their service to us.
                    </li>
                    <li>
                        <strong className="text-foreground">When required by law</strong>{' '}
                        or to protect the rights, safety and security of our
                        users and the service.
                    </li>
                </List>
            </Section>

            <Section id="storage-security" title="Storage and security">
                <List>
                    <li>
                        Access and refresh tokens are encrypted at rest with
                        AES-256-GCM and are never sent to your browser.
                    </li>
                    <li>
                        Connection flows use OAuth 2.0 with PKCE, single-use
                        state and a browser-binding check so a connection can
                        only be completed by the browser that started it.
                    </li>
                    <li>All traffic is served over HTTPS.</li>
                </List>
                <p>
                    No method of storage or transmission is completely secure,
                    but we work to protect your information and limit access to
                    it.
                </p>
            </Section>

            <Section id="retention" title="Data retention">
                <p>
                    We keep your data for as long as your account is active.
                    Tokens for a connected account are deleted when you
                    disconnect it; its profile details are kept with your post
                    history until you delete your account. Temporary
                    data used during a connection attempt expires after 10
                    minutes.
                </p>
            </Section>

            <Section id="data-deletion" title="Data deletion">
                <p>You can delete your data at any time:</p>
                <List>
                    <li>
                        <strong className="text-foreground">Disconnect an account</strong>{' '}
                        — in Fannout, open{' '}
                        <Link
                            href="/connections"
                            className="text-foreground underline underline-offset-2"
                        >
                            Connections
                        </Link>{' '}
                        and disconnect it. We immediately delete its access and
                        refresh tokens; its name and ID stay linked to your post
                        history until you delete your account.
                    </li>
                    <li>
                        <strong className="text-foreground">Remove Fannout from Facebook</strong>{' '}
                        — go to Facebook Settings &amp; privacy → Settings →
                        Business integrations (or Apps and websites), select
                        Fannout and remove it. This revokes our access.
                    </li>
                    <li>
                        <strong className="text-foreground">Delete everything</strong>{' '}
                        — email {mail} from the address on your account with the
                        subject &ldquo;Delete my data&rdquo;. We delete your
                        account, posts, media, connected accounts and tokens
                        within 30 days and confirm by email.
                    </li>
                </List>
            </Section>

            <Section id="your-rights" title="Your rights">
                <p>
                    Depending on where you live, you may have the right to
                    access, correct, export or delete your personal data, and to
                    object to or restrict its processing. Contact us at {mail}{' '}
                    to make a request.
                </p>
            </Section>

            <Section id="children" title="Children">
                <p>
                    Fannout is not directed to children under 13 (or the
                    minimum age in your country), and we do not knowingly
                    collect their data.
                </p>
            </Section>

            <Section id="changes" title="Changes to this policy">
                <p>
                    We may update this policy. We will change the &ldquo;Last
                    updated&rdquo; date above and, for significant changes,
                    notify you in the app or by email.
                </p>
            </Section>

            <Section id="contact" title="Contact us">
                <p>Questions about this policy or your data: {mail}.</p>
            </Section>
        </article>
    )
}
