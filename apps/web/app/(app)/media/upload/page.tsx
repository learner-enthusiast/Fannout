import type { Metadata } from 'next'

import { PageHeader } from '~/components/layout/page-header'
import { BackButton } from '~/components/media/media-detail'
import { MediaUpload } from '~/components/media/media-upload'

export const metadata: Metadata = { title: 'Upload media' }

export default function MediaUploadPage() {
    return (
        <>
            <PageHeader
                title="Upload media"
                description="Videos and images up to 5 GB; SRT/VTT subtitles and JSON up to 1 MB."
                actions={<BackButton />}
            />
            <MediaUpload />
        </>
    )
}
