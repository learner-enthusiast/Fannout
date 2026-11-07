import { redirect } from 'next/navigation'

/** Upload is a popup now; keep old links working. */
export default function MediaUploadPage() {
    redirect('/media?upload=1')
}
