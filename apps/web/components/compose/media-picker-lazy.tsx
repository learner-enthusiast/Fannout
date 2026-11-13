'use client'

import dynamic from 'next/dynamic'
import { useState, type ComponentProps } from 'react'

type Loaded = typeof import('./media-picker-dialog')
const load = () => import('./media-picker-dialog')

const Dialog = dynamic(() => load().then((m: Loaded) => m.MediaPickerDialog), { ssr: false })

/** Warm the chunk (call on pointer-enter / focus of anything that opens the picker). */
export function preloadMediaPicker() {
    void load()
}

type Props = ComponentProps<Loaded['MediaPickerDialog']>

/**
 * The picker body is heavy (lists, folder tree) and is rendered several times per page.
 * It is code-split and only mounted once it has been opened for the first time.
 */
export function MediaPickerDialog(props: Props) {
    const [everOpened, setEverOpened] = useState(props.open)
    if (props.open && !everOpened) setEverOpened(true)
    return everOpened ? <Dialog {...props} /> : null
}
