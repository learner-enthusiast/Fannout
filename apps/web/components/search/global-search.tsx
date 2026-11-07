'use client'

import { FolderIcon, SearchIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { MediaPreview } from '~/components/media/media-preview'
import { Button } from '~/components/ui/button'
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '~/components/ui/command'
import { Kbd } from '~/components/ui/kbd'
import { Spinner } from '~/components/ui/spinner'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { TYPE_LABEL } from '~/lib/media-roles'
import { trpc } from '~/trpc/client'

/** Header search (⌘K / Ctrl+K): folders and media by name, then jump to them. */
export function GlobalSearch() {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const q = useDebouncedValue(query.trim(), 200)

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                setOpen((current) => !current)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const results = trpc.search.unified.useQuery(
        { q, limit: 8 },
        { enabled: open && q.length > 0, staleTime: 10_000, placeholderData: (previous) => previous }
    )

    const go = (href: string) => {
        setOpen(false)
        setQuery('')
        router.push(href)
    }
    const folders = q ? (results.data?.folders ?? []) : []
    const media = q ? (results.data?.media ?? []) : []

    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                leftIcon={<SearchIcon aria-hidden />}
                aria-label="Search folders and media"
                onClick={() => setOpen(true)}
            >
                <span className="hidden sm:inline">Search</span>
                <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
            </Button>
            <CommandDialog
                open={open}
                onOpenChange={setOpen}
                title="Search"
                description="Find folders and media by name"
            >
                <Command shouldFilter={false}>
                    <CommandInput placeholder="Search folders and media…" value={query} onValueChange={setQuery} />
                    <CommandList>
                        {!q ? (
                            <p className="px-4 py-6 text-center text-meta">Type a name, e.g. &ldquo;graph&rdquo;.</p>
                        ) : results.isFetching && !results.data ? (
                            <div className="flex justify-center py-6">
                                <Spinner />
                            </div>
                        ) : (
                            <CommandEmpty>No folders or media match &ldquo;{q}&rdquo;.</CommandEmpty>
                        )}
                        {folders.length > 0 ? (
                            <CommandGroup heading="Folders">
                                {folders.map((folder) => (
                                    <CommandItem
                                        key={folder.id}
                                        value={`folder-${folder.id}`}
                                        onSelect={() => go(`/media/folders/${folder.id}`)}
                                    >
                                        <FolderIcon aria-hidden />
                                        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                                        <span className="text-mono text-muted-foreground">{folder.itemCount}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ) : null}
                        {media.length > 0 ? (
                            <CommandGroup heading="Media">
                                {media.map((item) => (
                                    <CommandItem key={item.id} value={`media-${item.id}`} onSelect={() => go(`/media/${item.id}`)}>
                                        <span className="w-12 shrink-0 overflow-hidden rounded-control">
                                            <MediaPreview type={item.type} url={item.type === 'image' ? item.url : null} alt="" />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                        <span className="text-meta">{TYPE_LABEL[item.type]}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ) : null}
                    </CommandList>
                </Command>
            </CommandDialog>
        </>
    )
}
