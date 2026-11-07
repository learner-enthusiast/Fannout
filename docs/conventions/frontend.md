# Frontend conventions (Fannout)

Mandatory for `apps/web`, together with [DESIGN.md](../../apps/web/DESIGN.md).

## Lists

- Every list uses **`useInfiniteList` + `<InfiniteList>`**
  (`apps/web/hooks/use-infinite-list.ts`, `apps/web/components/infinite-list.tsx`):
  `trpc.x.list.useInfiniteQuery(input, infiniteOptions())` → `useInfiniteList(query)`
  → `<InfiniteList list={…} renderItem getKey skeleton empty />`. It gives the
  sentinel-based infinite scroll (200 px early), skeletons while loading, the
  "No more items" footer, inline retry, and the EmptyState.
- Never render a paginated list with a "load all" fetch or numbered pages.
- Lists inside popovers/dialogs pass their scroll container as `root`.
- Filter/search change resets to page 1 and **keeps old results visible**
  (`infiniteOptions()` sets `placeholderData: keepPreviousData`) until new data arrives.

## Mutations

- Create/update/delete on list items are **optimistic**: snapshot every cached
  page that contains the item, update all of them (lists, detail views, search,
  counts), restore on error with a destructive toast, invalidate on settle. Use
  `lib/optimistic.ts` (`removeFromInfiniteCache`, `updateCache`, `restoreSnapshot`).
  Reference: `components/library/delete-actions.tsx`.
- Disable the item's actions while its mutation is in flight (`useIsDeleting`).

## Destructive actions

- Always **ConfirmDialog**: the title names the item in quotes, the body states
  the consequences (what else is removed, what is NOT affected), the destructive
  button is on the right, Enter never confirms (focus starts on Cancel).
- Card actions live in a **kebab DropdownMenu** (`CardMenu`, top-right, visible on
  hover/focus, always on touch); Delete is the last item, destructive style; the
  Delete key on a focused card opens the same dialog.
- Success toast **"Deleted “{name}”"**; no Undo unless the backend supports restore.
