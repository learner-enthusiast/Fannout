import type { AppErrorPayload } from '~/lib/error'

type BlockingItem = {
    name: string
    posts: { name: string; status: string }[]
}

/** Expands MEDIA_IN_USE API details into a clearer delete error message. */
export function formatMediaInUseError(payload: AppErrorPayload): string {
    if (payload.code !== 'MEDIA_IN_USE') return payload.message
    const items = (payload.details as { items?: BlockingItem[] } | undefined)?.items
    if (!items?.length) return payload.message

    const refs = items.flatMap((item) =>
        item.posts.map((post) => `“${post.name}” (${post.status})`)
    )
    const sample = refs.slice(0, 3).join(', ')
    const extra = refs.length > 3 ? ` and ${refs.length - 3} more` : ''
    return `${payload.message} Blocked by: ${sample}${extra}. Open Posts, cancel or finish those posts, then try again.`
}