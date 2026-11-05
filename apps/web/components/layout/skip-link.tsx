/** First focusable element on every page: jumps to <main id="content">. */
export function SkipLink() {
    return (
        <a
            href="#content"
            className="sr-only z-50 rounded-control bg-primary px-4 py-2 text-label text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
        >
            Skip to content
        </a>
    )
}
