import type { Metadata } from 'next'

import { PostDetail } from '~/components/posts/post-detail'

export const metadata: Metadata = { title: 'Post' }

export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
    const { postId } = await params
    return <PostDetail postId={postId} />
}
