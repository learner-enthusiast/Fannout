'use client'

import { UploadIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '~/components/ui/popover'

import { UploadList } from './upload-list'
import { useUploadActions, useUploadActiveCount, useUploadCount } from './upload-provider'

/** Header button with active-upload count; hidden when there are no uploads. */
export function UploadsIndicator() {
    const total = useUploadCount()
    const activeCount = useUploadActiveCount()
    const { clearFinished } = useUploadActions()
    if (total === 0) return null
    const finished = total - activeCount

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<UploadIcon aria-hidden />}
                        aria-label={`Uploads: ${activeCount} in progress`}
                    />
                }
            >
                <span className="text-mono">{activeCount}</span>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96">
                <PopoverHeader>
                    <div className="flex items-center justify-between gap-2">
                        <PopoverTitle>Uploads</PopoverTitle>
                        {finished > 0 ? (
                            <Button variant="ghost" size="sm" onClick={clearFinished}>
                                Clear Finished
                            </Button>
                        ) : null}
                    </div>
                </PopoverHeader>
                <div className="max-h-96 overflow-y-auto">
                    <UploadList />
                </div>
            </PopoverContent>
        </Popover>
    )
}
