# Popup performance

Measured on a **production build** (`next build` + `next start`, copy of `apps/web` served on :3100, API on :8000),
headless Chromium, 1440×900, 5 runs per popup, median. Script: `docs/perf/measure-popups.mjs`
(needs a Playwright `storageState` JSON for a signed-in user).
"Mounted" = content has a box; "Visible" = opacity ≥ 0.98 (animation finished).

## Before / after

| Popup | Mounted (before → after) | Visible (before → after) | Long tasks > 50 ms |
|---|---|---|---|
| Notification bell | 49 → 48 ms | 132 → 181 ms | none |
| User menu | 55 → 59 ms | 148 → 149 ms | 1 × ~76 ms (both runs) |
| Media: Type filter | 66 → 66 ms | 66 → 66 ms | none |
| Media: Orientation filter | 66 → 65 ms | 66 → 65 ms | none |
| Media: Upload dialog | 49 → 48 ms | 261 → 190 ms | none |
| Header search | 49 → 49 ms | 258 → 182 ms | none |

Dialogs/search: −70 to −75 ms (200 ms `duration-base` → 150 ms open, backdrop-blur removed).
Popover-based menus (bell): +49 ms visible, because the spec raises popover open animation from 100 ms to 150 ms;
content is mounted at the same time (~48 ms) so nothing waits on it.

## Root causes found

1. **Upload progress in React context.** `UploadProvider` kept `items` (with per-file progress) in its
   context value and patched it on every XHR progress event, so every `useUploads` consumer re-rendered
   on every tick, and the provider's own effects (queue pump, processing poll, beforeunload) re-ran.
   → external store (`components/uploads/upload-store.ts`), selector subscriptions, progress flushed ≤ 5/s,
   effects keyed on a progress-free "structure" string, stable context value.
2. **`backdrop-blur` on every overlay and menu.** Dialog/alert-dialog/sheet/drawer overlays used
   `backdrop-blur-sm`; dropdown, select, context-menu and menubar popups each had a `before:backdrop-blur-2xl`
   + `backdrop-saturate-150` pseudo-element (a full-size blur layer behind every open menu). Removed.
3. **Animation timing.** Dialogs used 200 ms both ways; popups 100 ms. Now 150 ms open / 100 ms close.
4. **No prefetch for the bell.** The list was fetched only after opening. Now prefetched on pointer-enter/focus.
5. **Tooltips.** Root `TooltipProvider` already existed (delay 300); added `closeDelay` 100 and skip window 100.
6. **Scroll-lock layout shift.** Added `scrollbar-gutter: stable` on `html`.

Already fine: polling hooks use `refetchInterval` without `refetchIntervalInBackground`, so React Query
pauses them in hidden tabs. No hydration warnings in the console on /dashboard, /compose, /media.

## Compose changes (code-reviewed only, NOT measured)

The test account had no connected social accounts, so `/compose` could not be rendered or profiled.
These changes pass typecheck, lint and tests but were **not** verified in the browser; please check
typing in a card, AI generate/undo, schedule, thumbnail pick and "copy from" with 2+ accounts.

- `account-card.tsx`: `AccountCard` is now a thin shell over a `React.memo` body. The shell keeps the latest
  props in a ref and passes stable proxy handlers, so a card whose data did not change skips rendering while
  its handlers still call the freshest callbacks (no stale closures). Slots (header chip, schedule control) and
  the AI state are compared by data, not identity. Expected effect: typing in one card no longer re-renders the others.
  (Chosen over per-card react-hook-form / store slices because that would rewrite the 1,000-line compose state.)
- `media-picker-lazy.tsx`: the media/folder picker is code-split (`next/dynamic`), mounted only after the first
  open, and its chunk + first page of media are prefetched on pointer-enter/focus of the buttons that open it.
  Used by compose and post actions.
- Mention search: `placeholderData: keepPreviousData` (debounce 150 ms and limit 10 already existed).
- `media-preview.tsx`: `decoding="async"` (images were already `loading="lazy"`).

## Also done after the first round

- **Virtualization (> 30 items):** `InfiniteList` takes an opt-in `virtual={{ estimateSize, columns?, gap? }}`
  (`@tanstack/react-virtual`); it windows only when a `root` scroll container is given and the list has more than
  30 items. Used by the media picker (grid, 2 cols mobile / 4 cols ≥ 640 px) and its folder list.
  **Verified in a production build** with a throwaway page: 300 items rendered 12–16 DOM rows (single column) and
  32–52 (4-column grid) while scrolling to the middle and end (last item reachable); a 10-item list renders fully.
- **Small thumbnails:** the worker now writes a ≤ 320 px JPEG next to every ready image/video (ffmpeg, best effort,
  after "ready" so it never delays or fails an upload; key in `media.metadata.thumbnailKey`, no migration).
  API: `thumbUrl` on media and folder items (documented in `docs/ai.md`). The web app uses it in the picker, library,
  folders, search-adjacent previews and compose cards instead of the original / a `<video>` per tile.
  Deleting media deletes its thumbnail. Unit-tested against real ffmpeg output (image + video).
  **Existing media has no thumbnail until backfilled**: `scripts/backfill-thumbnails.ts` (written, not run); until
  then the UI falls back to the original, as before.
- **z-index scale** (`globals.css`): overlay 50 (dialog, sheet, drawer, alert-dialog) < dropdown 60 (select, menus,
  combobox) < popover 70 (popover, hover-card) < tooltip 80 < toast (sonner). *Deviation from the spec order
  (dropdown < popover < dialog < toast):* menus and popovers sit ABOVE dialogs, otherwise a select/popover opened
  inside a dialog renders under it. **Verified:** a Select opened inside a Dialog is the hit-test target (z 60 vs 50).

## Not done

- Per-card react-hook-form / store slices: replaced by the memoized-card shell (see above); not profiled because the
  test account has no connected social accounts, so compose render counts are still unmeasured.
- The ~77 ms long task when the user menu opens (a Clerk-rendered `role="dialog"`).
