'use client'

import { format, formatDistanceToNowStrict } from 'date-fns'
import { CopyIcon, KeyRoundIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { ConfirmDialog } from '~/components/ui/confirm-dialog'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog'
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
import { Skeleton } from '~/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { trpc } from '~/trpc/client'
import { InfiniteList } from '~/components/infinite-list'
import { infiniteOptions, useInfiniteList } from '~/hooks/use-infinite-list'

const SCOPES = [
    { value: 'posts:read', label: 'Read posts' },
    { value: 'posts:write', label: 'Create & edit posts' },
    { value: 'posts:delete', label: 'Delete posts' },
    { value: 'media:read', label: 'Read media' },
    { value: 'media:write', label: 'Upload & manage media' },
    { value: 'connections:read', label: 'Read connected accounts' },
    { value: 'ai:generate', label: 'Generate with AI' },
] as const
type Scope = (typeof SCOPES)[number]['value']

const EXPIRY: Record<string, { label: string; days: 30 | 90 | 365 | null }> = {
    '30': { label: '30 days', days: 30 },
    '90': { label: '90 days', days: 90 },
    '365': { label: '1 year', days: 365 },
    never: { label: 'Never', days: null },
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const utils = trpc.useUtils()
    const [name, setName] = useState('')
    const [scopes, setScopes] = useState<Scope[]>(['posts:read'])
    const [expiry, setExpiry] = useState('90')
    const [created, setCreated] = useState<{ key: string; prefix: string } | null>(null)
    const create = trpc.apiKeys.create.useMutation({
        onSuccess: (result) => {
            setCreated(result)
            void utils.apiKeys.list.invalidate()
        },
    })
    const close = (next: boolean) => {
        if (!next) {
            setCreated(null)
            setName('')
            setScopes(['posts:read'])
        }
        onOpenChange(next)
    }

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent>
                {created ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Copy your API key</DialogTitle>
                            <DialogDescription>Use it as <code>Authorization: Bearer …</code>.</DialogDescription>
                        </DialogHeader>
                        <Alert variant="warning">
                            <TriangleAlertIcon aria-hidden />
                            <AlertTitle>You won&rsquo;t see this again</AlertTitle>
                            <AlertDescription>Store it somewhere safe now. Fannout only keeps a hash.</AlertDescription>
                        </Alert>
                        <div className="flex items-center gap-2">
                            <Input readOnly value={created.key} aria-label="API key" onFocus={(e) => e.target.select()} />
                            <Button
                                variant="secondary"
                                leftIcon={<CopyIcon aria-hidden />}
                                onClick={() => {
                                    void navigator.clipboard.writeText(created.key).then(
                                        () => toast.success('Copied'),
                                        () => toast.error('Copy failed — select and copy it manually')
                                    )
                                }}
                            >
                                Copy
                            </Button>
                        </div>
                        <DialogFooter>
                            <Button variant="primary" onClick={() => close(false)}>
                                Done
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>Create API key</DialogTitle>
                            <DialogDescription>Give it only the scopes it needs.</DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-4">
                            <FormField label="Name" required>
                                {(p) => <Input {...p} value={name} maxLength={60} placeholder="e.g. CI publisher" onChange={(e) => setName(e.target.value)} />}
                            </FormField>
                            <fieldset className="flex flex-col gap-2">
                                <legend className="text-label text-foreground">Scopes *</legend>
                                {SCOPES.map((scope) => (
                                    <label key={scope.value} className="flex items-center gap-2 text-foreground">
                                        <Checkbox
                                            checked={scopes.includes(scope.value)}
                                            onCheckedChange={(checked) =>
                                                setScopes((current) =>
                                                    checked === true ? [...current, scope.value] : current.filter((s) => s !== scope.value)
                                                )
                                            }
                                        />
                                        {scope.label} <span className="text-mono text-muted-foreground">{scope.value}</span>
                                    </label>
                                ))}
                            </fieldset>
                            <FormField label="Expires">
                                {(p) => (
                                    <Select<string> value={expiry} onValueChange={(v) => v && setExpiry(v)}>
                                        <SelectTrigger {...p}>
                                            <SelectValue>{(v: string) => EXPIRY[v]?.label}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {Object.entries(EXPIRY).map(([value, { label }]) => (
                                                    <SelectItem key={value} value={value}>
                                                        {label}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                )}
                            </FormField>
                        </div>
                        <DialogFooter>
                            <Button variant="secondary" onClick={() => close(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                disabled={!name.trim() || scopes.length === 0}
                                loading={create.isPending}
                                onClick={() => create.mutate({ name: name.trim(), scopes, expiresInDays: EXPIRY[expiry]!.days })}
                            >
                                Create Key
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

export function ApiKeysSettings() {
    const utils = trpc.useUtils()
    const keysQuery = trpc.apiKeys.list.useInfiniteQuery({}, infiniteOptions({ staleTime: 0 }))
    const list = useInfiniteList(keysQuery)
    const [open, setOpen] = useState(false)
    const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)
    const revoke = trpc.apiKeys.revoke.useMutation({
        onSuccess: () => {
            toast.success('Key revoked')
            void utils.apiKeys.list.invalidate()
        },
    })

    return (
        <Card>
            <CardHeader>
                <CardTitle>API keys</CardTitle>
                <CardDescription>
                    Call the Fannout API with <code>Authorization: Bearer fn_live_…</code>. Read the <a className="underline" href="/ai.md">agent guide</a> or API docs at <code>/docs</code>.
                </CardDescription>
                <CardAction>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            leftIcon={<CopyIcon aria-hidden />}
                            onClick={() => {
                                void fetch('/ai.md')
                                    .then((response) => {
                                        if (!response.ok) throw new Error('Guide request failed')
                                        return response.text()
                                    })
                                    .then((guide) => navigator.clipboard.writeText(guide))
                                    .then(
                                        () => toast.success('Agent guide copied'),
                                        () => toast.error('Copy failed — open the agent guide and copy it manually')
                                    )
                            }}
                        >
                            Copy agent guide
                        </Button>
                        <Button variant="primary" leftIcon={<PlusIcon aria-hidden />} onClick={() => setOpen(true)}>
                            Create Key
                        </Button>
                    </div>
                </CardAction>
            </CardHeader>
            <CardContent>
                <InfiniteList
                    list={list}
                    getKey={(key) => key.id}
                    skeleton={<Skeleton className="h-10 w-full" />}
                    empty={<EmptyState icon={KeyRoundIcon} title="No API keys" description="Create a key to use Fannout from scripts or CI." />}
                    container={(rows) => (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Key</TableHead>
                                    <TableHead>Scopes</TableHead>
                                    <TableHead>Last used</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead>
                                        <span className="sr-only">Actions</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>{rows}</TableBody>
                        </Table>
                    )}
                    renderItem={(key) => {
                                const expired = key.expiresAt && new Date(key.expiresAt) < new Date()
                                return (
                                    <TableRow key={key.id}>
                                        <TableCell className="text-foreground">{key.name}</TableCell>
                                        <TableCell className="text-mono">{key.prefix}…</TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {key.scopes.map((s) => (
                                                    <Badge key={s} variant="outline">
                                                        {s}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-meta">
                                            {key.lastUsedAt ? formatDistanceToNowStrict(new Date(key.lastUsedAt), { addSuffix: true }) : 'Never'}
                                        </TableCell>
                                        <TableCell className="text-meta">{format(new Date(key.createdAt), 'PP')}</TableCell>
                                        <TableCell className="text-meta">{key.expiresAt ? format(new Date(key.expiresAt), 'PP') : 'Never'}</TableCell>
                                        <TableCell>
                                            {key.revokedAt ? (
                                                <Badge variant="neutral">Revoked</Badge>
                                            ) : expired ? (
                                                <Badge variant="neutral">Expired</Badge>
                                            ) : (
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    leftIcon={<Trash2Icon aria-hidden />}
                                                    onClick={() => setRevoking({ id: key.id, name: key.name })}
                                                >
                                                    Revoke
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            }}
                />
            </CardContent>
            <CreateKeyDialog open={open} onOpenChange={setOpen} />
            <ConfirmDialog
                open={revoking !== null}
                onOpenChange={(o) => !o && setRevoking(null)}
                title={`Revoke ${revoking?.name ?? 'this key'}?`}
                description="Anything using it stops working immediately. This can't be undone."
                confirmLabel="Revoke Key"
                onConfirm={async () => {
                    if (revoking) await revoke.mutateAsync({ id: revoking.id })
                }}
            />
        </Card>
    )
}
