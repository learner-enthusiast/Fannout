'use client'

import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '~/components/ui/select'
import { ROLE_LABEL, rolesFor, type FolderRole, type MediaType } from '~/lib/media-roles'

/** Role picker limited to the roles that accept this media type. */
export function RoleSelect({
    type,
    value,
    onChange,
    size = 'sm',
    'aria-label': ariaLabel,
}: {
    type: MediaType
    value: FolderRole
    onChange: (role: FolderRole) => void
    size?: 'sm' | 'md'
    'aria-label'?: string
}) {
    return (
        <Select value={value} onValueChange={(next) => next && onChange(next as FolderRole)}>
            <SelectTrigger size={size} aria-label={ariaLabel ?? 'Role'}>
                <SelectValue>{(v: FolderRole) => ROLE_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {rolesFor(type).map((role) => (
                        <SelectItem key={role} value={role}>
                            {ROLE_LABEL[role]}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    )
}
