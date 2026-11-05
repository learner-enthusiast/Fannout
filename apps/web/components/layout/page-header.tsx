/**
 * PageHeader — the h1 of every app page: title (24/32 semibold), optional
 * one-line description, actions on the right (max one primary, rightmost).
 */
export function PageHeader({
    title,
    description,
    actions,
}: {
    title: string
    description?: React.ReactNode
    actions?: React.ReactNode
}) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-page-title text-foreground">{title}</h1>
                {description ? (
                    <p className="text-sm text-muted-foreground">
                        {description}
                    </p>
                ) : null}
            </div>
            {actions ? (
                <div className="flex shrink-0 items-center gap-2">
                    {actions}
                </div>
            ) : null}
        </div>
    )
}
