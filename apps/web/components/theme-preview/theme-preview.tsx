'use client'

import * as React from 'react'
import {
    CableIcon,
    CircleCheckIcon,
    InfoIcon,
    OctagonAlertIcon,
    PlusIcon,
    SendIcon,
    Trash2Icon,
    TriangleAlertIcon,
    UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { brand, colorTokenNames, type ThemeName } from '~/lib/brand'
import { cn } from '~/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '~/components/ui/card'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '~/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { EmptyState } from '~/components/ui/empty-state'
import { FormField } from '~/components/ui/form-field'
import { Input } from '~/components/ui/input'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import {
    StatusBadge,
    statusMap,
    type Status,
} from '~/components/ui/status-badge'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '~/components/ui/tooltip'
import { PageHeader } from '~/components/layout/page-header'

const variants = [
    'primary',
    'secondary',
    'ghost',
    'destructive',
    'link',
] as const
const sizes = ['sm', 'md', 'lg'] as const
const iconSizes = ['icon-sm', 'icon', 'icon-lg'] as const
const states = ['default', 'hover', 'focus', 'disabled', 'loading'] as const

/** Example "weighted" counter: X/Twitter-style — non-Latin graphemes weigh 2, URLs 23. */
function weighPost(value: string) {
    const urls = value.match(/https?:\/\/\S+/g) ?? []
    let rest = value
    for (const url of urls) rest = rest.replace(url, '')
    let weight = urls.length * 23
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const { segment } of segmenter.segment(rest)) {
        weight += (segment.codePointAt(0) ?? 0) > 0x10ff ? 2 : 1
    }
    return weight
}

function Section({
    title,
    description,
    children,
}: {
    title: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <section className="flex flex-col gap-4" aria-labelledby={slug(title)}>
            <div className="flex flex-col gap-1">
                <h2
                    id={slug(title)}
                    className="text-section-title text-foreground"
                >
                    {title}
                </h2>
                {description ? (
                    <p className="text-meta text-muted-foreground">
                        {description}
                    </p>
                ) : null}
            </div>
            {children}
        </section>
    )
}

function slug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function Swatches({ theme }: { theme: ThemeName }) {
    const values = brand[theme]
    return (
        <div
            className={cn(
                theme,
                'rounded-surface border border-border bg-background p-4'
            )}
        >
            <p className="mb-4 text-label text-foreground">
                {theme === 'dark' ? 'Dark (default)' : 'Light (beige)'}
            </p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {colorTokenNames.map((name) => (
                    <li key={name} className="flex items-center gap-3">
                        <span
                            className="size-8 shrink-0 rounded-control border border-border"
                            style={{ background: `var(--${name})` }}
                        />
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate text-meta text-foreground">
                                {name}
                            </span>
                            <span className="text-mono text-muted-foreground">
                                {values[name]}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    )
}

function ButtonMatrix() {
    return (
        <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-2 text-start">
                <thead>
                    <tr>
                        <th
                            scope="col"
                            className="text-start text-meta text-muted-foreground"
                        >
                            variant
                        </th>
                        {states.map((state) => (
                            <th
                                key={state}
                                scope="col"
                                className="text-start text-meta text-muted-foreground"
                            >
                                {state}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {variants.map((variant) => (
                        <tr key={variant}>
                            <th
                                scope="row"
                                className="text-start align-top text-mono"
                            >
                                {variant}
                            </th>
                            {states.map((state) => (
                                <td key={state} className="align-top">
                                    <div className="flex flex-col items-start gap-2">
                                        {sizes.map((size) => (
                                            <Button
                                                key={size}
                                                variant={variant}
                                                size={size}
                                                data-force={
                                                    state === 'hover' ||
                                                    state === 'focus'
                                                        ? state
                                                        : undefined
                                                }
                                                disabled={state === 'disabled'}
                                                loading={state === 'loading'}
                                                leftIcon={
                                                    variant ===
                                                    'link' ? undefined : (
                                                        <SendIcon aria-hidden />
                                                    )
                                                }
                                            >
                                                Publish {size}
                                            </Button>
                                        ))}
                                        <div className="flex items-center gap-2">
                                            {variant === 'link'
                                                ? null
                                                : iconSizes.map((size) => (
                                                      <Button
                                                          key={size}
                                                          variant={variant}
                                                          size={size}
                                                          aria-label={`Add (${size})`}
                                                          data-force={
                                                              state ===
                                                                  'hover' ||
                                                              state === 'focus'
                                                                  ? state
                                                                  : undefined
                                                          }
                                                          disabled={
                                                              state ===
                                                              'disabled'
                                                          }
                                                          loading={
                                                              state ===
                                                              'loading'
                                                          }
                                                      >
                                                          <PlusIcon
                                                              aria-hidden
                                                          />
                                                      </Button>
                                                  ))}
                                        </div>
                                    </div>
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

const bengaliSample = 'আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।'

function FormControls() {
    const [caption, setCaption] = React.useState(
        'Launching our new video today — check it out!'
    )
    const [bengali, setBengali] = React.useState(bengaliSample)
    const [post, setPost] = React.useState(
        'নতুন ভিডিও এসেছে! Watch https://example.com/watch?v=fannout'
    )
    const [title, setTitle] = React.useState('')
    const [titleError, setTitleError] = React.useState<string>()

    return (
        <div className="flex flex-col gap-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {sizes.map((size) => (
                    <div key={size} className="flex flex-col gap-4">
                        <p className="text-mono text-muted-foreground">
                            size={size}
                        </p>
                        <FormField
                            label="Title"
                            helper="Helper text sits below."
                        >
                            {(p) => (
                                <Input
                                    {...p}
                                    size={size}
                                    placeholder="Post title"
                                />
                            )}
                        </FormField>
                        <FormField label="Channel">
                            {(p) => (
                                <Select defaultValue="youtube">
                                    <SelectTrigger {...p} size={size}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="youtube">
                                                YouTube
                                            </SelectItem>
                                            <SelectItem value="instagram">
                                                Instagram
                                            </SelectItem>
                                            <SelectItem value="x">X</SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            )}
                        </FormField>
                        <FormField label="Notes">
                            {(p) => (
                                <Textarea
                                    {...p}
                                    size={size}
                                    placeholder="Optional"
                                />
                            )}
                        </FormField>
                        <div className="flex items-center gap-2">
                            <Input
                                size={size}
                                type="search"
                                name="search"
                                aria-label="Search posts"
                                placeholder="Search posts…"
                            />
                            <Button size={size}>Filter</Button>
                        </div>
                    </div>
                ))}
            </div>

            <Separator />

            <div className="grid max-w-form grid-cols-1 gap-4">
                <FormField
                    label="Post title"
                    required
                    helper="Validated on blur — leave it empty and tab away."
                    error={titleError}
                >
                    {(p) => (
                        <Input
                            {...p}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onBlur={() =>
                                setTitleError(
                                    title.trim() ? undefined : 'Enter a title.'
                                )
                            }
                        />
                    )}
                </FormField>
                <FormField
                    label="Error state"
                    error="This channel needs to be reconnected."
                >
                    {(p) => <Input {...p} defaultValue="@fannout" />}
                </FormField>
                <FormField
                    label="Disabled"
                    helper="Not editable on the free plan."
                >
                    {(p) => (
                        <Input {...p} disabled defaultValue="fannout.app" />
                    )}
                </FormField>
                <FormField
                    label="Caption (chars)"
                    helper="Counts user-perceived characters."
                    counter={{ value: caption, limit: 50 }}
                >
                    {(p) => (
                        <Textarea
                            {...p}
                            value={caption}
                            onChange={(e) => setCaption(e.target.value)}
                        />
                    )}
                </FormField>
                <FormField
                    label="Bengali caption (bytes)"
                    helper="UTF-8 bytes — each Bengali letter is 3 bytes."
                    counter={{ value: bengali, limit: 100, mode: 'bytes' }}
                >
                    {(p) => (
                        <Textarea
                            {...p}
                            lang="bn"
                            value={bengali}
                            onChange={(e) => setBengali(e.target.value)}
                        />
                    )}
                </FormField>
                <FormField
                    label="Post (weighted)"
                    helper="URLs count 23, non-Latin characters count 2."
                    counter={{
                        value: post,
                        limit: 80,
                        mode: 'weighted',
                        weigh: weighPost,
                    }}
                >
                    {(p) => (
                        <Textarea
                            {...p}
                            value={post}
                            onChange={(e) => setPost(e.target.value)}
                        />
                    )}
                </FormField>
                <FormField
                    orientation="horizontal"
                    label="Auto-publish"
                    helper="Publish as soon as processing finishes."
                >
                    {(p) => (
                        <Switch
                            id={p.id}
                            aria-describedby={p['aria-describedby']}
                            defaultChecked
                        />
                    )}
                </FormField>
                <div className="flex justify-end gap-2">
                    <Button>Cancel</Button>
                    <Button variant="primary">Save Changes</Button>
                </div>
            </div>
        </div>
    )
}

const typeScale = [
    { role: 'Page title', className: 'text-page-title', spec: '24/32 · 600' },
    {
        role: 'Section title',
        className: 'text-section-title',
        spec: '18/28 · 600',
    },
    { role: 'Body', className: 'text-body', spec: '14/22 · 400' },
    {
        role: 'Small / meta',
        className: 'text-meta text-muted-foreground',
        spec: '13/20 · 400',
    },
    { role: 'Label', className: 'text-label', spec: '14/20 · 500' },
    { role: 'Mono', className: 'text-mono', spec: '13/20 · 500 · Geist Mono' },
]

export function ThemePreview() {
    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Theme preview"
                description="Every token and shared component, as rendered by the current theme. Dev only."
            />

            <Section
                title="Colour tokens"
                description="Rendered from the CSS variables; hex from lib/brand.ts."
            >
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Swatches theme="dark" />
                    <Swatches theme="light" />
                </div>
            </Section>

            <Section
                title="Typography"
                description="The only sizes in the product."
            >
                <Card>
                    <CardContent className="flex flex-col gap-4">
                        {typeScale.map((row) => (
                            <div
                                key={row.role}
                                className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-8"
                            >
                                <span className="w-32 shrink-0 text-mono text-muted-foreground">
                                    {row.spec}
                                </span>
                                <span className={row.className}>
                                    {row.role} — Publish everywhere 1234567890
                                </span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </Section>

            <Section
                title="Buttons"
                description="Every variant × size × state. Hover/focus are pinned with data-force."
            >
                <Card>
                    <CardContent>
                        <ButtonMatrix />
                    </CardContent>
                </Card>
            </Section>

            <Section
                title="Inputs, selects and fields"
                description="Sizes match Button heights. Counters: chars, bytes, weighted."
            >
                <Card>
                    <CardContent>
                        <FormControls />
                    </CardContent>
                </Card>
            </Section>

            <Section title="Badges and status">
                <Card>
                    <CardContent className="flex flex-col gap-4">
                        <div className="flex flex-wrap gap-2">
                            <Badge>Neutral</Badge>
                            <Badge variant="primary">Primary</Badge>
                            <Badge variant="success">
                                <CircleCheckIcon aria-hidden />
                                Success
                            </Badge>
                            <Badge variant="warning">
                                <TriangleAlertIcon aria-hidden />
                                Warning
                            </Badge>
                            <Badge variant="destructive">
                                <OctagonAlertIcon aria-hidden />
                                Destructive
                            </Badge>
                            <Badge variant="outline">Outline</Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {(Object.keys(statusMap) as Status[]).map(
                                (status) => (
                                    <StatusBadge key={status} status={status} />
                                )
                            )}
                        </div>
                    </CardContent>
                </Card>
            </Section>

            <Section title="Card">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>YouTube</CardTitle>
                            <CardDescription>
                                Fannout Studio · 12.4k subscribers
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex items-center gap-2">
                            <StatusBadge status="connected" />
                            <span
                                translate="no"
                                className="text-mono text-muted-foreground"
                            >
                                id_8f2c91
                            </span>
                        </CardContent>
                        <CardFooter>
                            <Button>Preview</Button>
                            <Button
                                variant="primary"
                                leftIcon={<SendIcon aria-hidden />}
                            >
                                Publish Post
                            </Button>
                        </CardFooter>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Loading</CardTitle>
                            <CardDescription>
                                Skeletons match the final layout.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                                <Skeleton className="size-10 rounded-full" />
                                <div className="flex flex-1 flex-col gap-2">
                                    <Skeleton className="h-4 w-1/2" />
                                    <Skeleton className="h-3 w-1/3" />
                                </div>
                            </div>
                            <Skeleton className="h-20 w-full" />
                        </CardContent>
                    </Card>
                </div>
            </Section>

            <Section title="Alerts">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Alert variant="info">
                        <InfoIcon aria-hidden />
                        <AlertTitle>Scheduled maintenance</AlertTitle>
                        <AlertDescription>
                            Publishing pauses Sunday 02:00–02:30 UTC.
                        </AlertDescription>
                    </Alert>
                    <Alert variant="success">
                        <CircleCheckIcon aria-hidden />
                        <AlertTitle>All channels connected</AlertTitle>
                        <AlertDescription>
                            Posts will go out to 4 channels.
                        </AlertDescription>
                    </Alert>
                    <Alert variant="warning">
                        <TriangleAlertIcon aria-hidden />
                        <AlertTitle>Token expiring soon</AlertTitle>
                        <AlertDescription>
                            Instagram access expires in 3 days.
                        </AlertDescription>
                    </Alert>
                    <Alert variant="destructive">
                        <OctagonAlertIcon aria-hidden />
                        <AlertTitle>Reconnect required</AlertTitle>
                        <AlertDescription>
                            X rejected our token. Reconnect to keep publishing.
                        </AlertDescription>
                    </Alert>
                </div>
            </Section>

            <Section title="Overlays and feedback">
                <Card>
                    <CardContent className="flex flex-wrap items-center gap-2">
                        <Dialog>
                            <DialogTrigger render={<Button />}>
                                Open Dialog
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Rename channel</DialogTitle>
                                    <DialogDescription>
                                        Only you can see this name.
                                    </DialogDescription>
                                </DialogHeader>
                                <FormField label="Name">
                                    {(p) => (
                                        <Input
                                            {...p}
                                            defaultValue="Fannout Studio"
                                        />
                                    )}
                                </FormField>
                                <DialogFooter>
                                    <DialogClose render={<Button />}>
                                        Cancel
                                    </DialogClose>
                                    <DialogClose
                                        render={<Button variant="primary" />}
                                    >
                                        Save Name
                                    </DialogClose>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <ConfirmDialog
                            trigger={
                                <Button
                                    variant="destructive"
                                    leftIcon={<Trash2Icon aria-hidden />}
                                >
                                    Delete Post
                                </Button>
                            }
                            title="Delete this post?"
                            description="It will be removed from every connected channel. This can’t be undone."
                            confirmLabel="Delete Post"
                            onConfirm={() =>
                                new Promise<void>((resolve) =>
                                    setTimeout(resolve, 800)
                                ).then(() => {
                                    toast.success('Post deleted')
                                })
                            }
                        />
                        <DropdownMenu>
                            <DropdownMenuTrigger render={<Button />}>
                                Open Menu
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem>
                                        <UploadIcon aria-hidden />
                                        Upload Media
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                        <CableIcon aria-hidden />
                                        Connect Channel
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem variant="destructive">
                                        <Trash2Icon aria-hidden />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Upload media"
                                    />
                                }
                            >
                                <UploadIcon aria-hidden />
                            </TooltipTrigger>
                            <TooltipContent>Upload media</TooltipContent>
                        </Tooltip>
                        <Button
                            onClick={() =>
                                toast.success('Post published to 4 channels')
                            }
                        >
                            Success Toast
                        </Button>
                        <Button
                            onClick={() =>
                                toast.error('Publishing failed', {
                                    description:
                                        'YouTube returned a quota error.',
                                })
                            }
                        >
                            Error Toast
                        </Button>
                    </CardContent>
                </Card>
            </Section>

            <Section title="Tabs and switch">
                <Card>
                    <CardContent className="flex flex-col gap-6">
                        <Tabs defaultValue="all">
                            <TabsList>
                                <TabsTrigger value="all">All</TabsTrigger>
                                <TabsTrigger value="scheduled">
                                    Scheduled
                                </TabsTrigger>
                                <TabsTrigger value="published">
                                    Published
                                </TabsTrigger>
                            </TabsList>
                            <TabsContent
                                value="all"
                                className="text-muted-foreground"
                            >
                                All posts.
                            </TabsContent>
                            <TabsContent
                                value="scheduled"
                                className="text-muted-foreground"
                            >
                                Scheduled posts.
                            </TabsContent>
                            <TabsContent
                                value="published"
                                className="text-muted-foreground"
                            >
                                Published posts.
                            </TabsContent>
                        </Tabs>
                        <Tabs defaultValue="details">
                            <TabsList variant="line">
                                <TabsTrigger value="details">
                                    Details
                                </TabsTrigger>
                                <TabsTrigger value="schedule">
                                    Schedule
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        <div className="flex flex-wrap items-center gap-6">
                            <label className="flex items-center gap-2 text-label">
                                <Switch defaultChecked /> On
                            </label>
                            <label className="flex items-center gap-2 text-label">
                                <Switch /> Off
                            </label>
                            <label className="flex items-center gap-2 text-label">
                                <Switch disabled /> Disabled
                            </label>
                        </div>
                    </CardContent>
                </Card>
            </Section>

            <Section title="Empty state">
                <Card>
                    <CardContent>
                        <EmptyState
                            icon={CableIcon}
                            title="No channels yet"
                            description="Connect a channel to start publishing."
                            actions={
                                <>
                                    <Button>Learn More</Button>
                                    <Button
                                        variant="primary"
                                        leftIcon={<PlusIcon aria-hidden />}
                                    >
                                        Connect YouTube
                                    </Button>
                                </>
                            }
                        />
                    </CardContent>
                </Card>
            </Section>
        </div>
    )
}
