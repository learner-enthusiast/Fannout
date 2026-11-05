# Fannout design rules

Mandatory for all UI work in `apps/web`. Tokens live in `app/globals.css`
(single source of truth) and are mirrored in `lib/brand.ts`. The live reference
is `/theme-preview` (dev only). The rules are enforced by `pnpm lint`
(`scripts/lint-design.mjs`) and `pnpm test` (`test/*.test.ts`).

---

### 4.1 Color
- Only semantic tokens/utilities: bg-background, bg-card, bg-popover, border-border,
  text-foreground, text-muted-foreground, bg-primary, text-link, bg-accent,
  text-success / bg-success, warning, destructive. Never raw hex, rgb(), or Tailwind
  palette classes (bg-indigo-600, text-gray-500, ...).
- ONE primary action per screen/section. Everything else secondary or ghost.
- Status mapping (always the same):
    success     = published, connected, completed
    warning     = processing, expiring soon, needs attention
    destructive = failed, reconnect required, delete
    muted       = pending, draft, disabled
  Status is NEVER color-only: always icon + text (+ color).

### 4.2 Radius
- Controls (button, input, select, textarea, badge, tabs, toggle): radius-control (8px)
- Surfaces (card, dialog, popover, sheet, dropdown, alert, toast): radius-surface (12px)
- Avatars, status dots, switches: rounded-full
- No other radius values anywhere.

### 4.3 Size scale (shared by buttons AND inputs/selects)
| size | height | padding-x | text | icon |
| sm   | 32px   | 12px      | 13px | 14px |
| md   | 40px   | 16px      | 14px | 16px |  ← DEFAULT
| lg   | 48px   | 20px      | 16px | 18px |
| icon | 40×40 (icon-sm 32×32, icon-lg 48×48) |
- A control placed next to another control uses the SAME size.
- Use sm in tables/toolbars/dense card rows, md in forms and page actions,
  lg only for a hero CTA or the primary action on mobile.

### 4.4 Buttons — exactly these variants
| variant     | look                                         | use |
| primary     | bg-primary, text-primary-foreground, hover bg-primary-hover | the one main action |
| secondary   | bg-card + 1px border-border, hover bg-popover | other actions (Cancel, Preview) |
| ghost       | transparent, hover bg-muted                  | toolbar / icon actions |
| destructive | bg-destructive, text-destructive-foreground | delete / disconnect (always confirm) |
| link        | text-link, underline on hover, no padding    | inline navigation |
States (identical for every variant):
- hover: one step (defined above), duration-fast
- active/pressed: translate-y-px
- focus-visible: 2px ring in --ring with 2px offset (offset color = background)
- disabled: opacity-50, pointer-events-none, aria-disabled
- loading: spinner replaces the leading icon, label stays, WIDTH DOES NOT CHANGE,
  button disabled, aria-busy
Rules: label = verb in Title Case ("Connect YouTube"); max one leading 16px icon;
icon-only buttons require tooltip + aria-label; in button pairs the primary is on the RIGHT;
destructive actions open a confirm dialog with the destructive button on the right.

### 4.5 Spacing & layout
- 4px grid only: 4, 8, 12, 16, 24, 32, 48, 64. No arbitrary values.
- Inside a control: 8px gap. Between form fields: 16px. Between sections: 32px.
- Card padding 24px (16px < md). Page padding 24px desktop / 16px mobile.
- Content max-width 1200px for pages; forms max 640px.

### 4.6 Typography
| role          | size/line | weight | color |
| page title    | 24/32     | 600    | foreground |
| section title | 18/28     | 600    | foreground |
| body          | 14/22     | 400    | foreground |  ← default
| small/meta    | 13/20     | 400    | muted-foreground |
| label         | 14/20     | 500    | foreground |
| mono (numbers, IDs, counters) | 13/20 | 500 | font-mono |
No other sizes. Sentence case for headings, Title Case for buttons.

### 4.7 Surfaces & depth
page = bg-background; content = bg-card + 1px border-border + radius-surface;
floating (dropdown, popover, dialog, toast) = bg-popover + shadow-float.
Borders over shadows: ONLY floating layers get a shadow.

### 4.8 Icons
lucide-react only. 16px inline/buttons, 20px sidebar, 24px empty states.
stroke width 2 (1.75 at 24px). Icon color inherits text color.

### 4.9 Forms
Label above field; helper text below (muted); error replaces helper (destructive, with
icon). Required = "*" after label. Char counters right-aligned under the field (mono):
warning at ≥90% of limit, destructive when over. Validate on blur + submit, not per keystroke.
Inputs: same heights as buttons; bg-background (dark) / bg-popover (light); border-input;
focus ring identical to buttons.

### 4.10 Feedback
- Action result → toast (bottom-right, 4s, success/destructive variants, icon + text).
- Blocking problem → inline Alert at the top of the section (radius-surface).
- Loading → skeletons shaped like the final content (no full-page spinners).
- Empty state → 24px icon + one sentence + one primary button.

### 4.11 Motion
150ms hover/press, 200ms open/close, ease-out. No bounce/spring. Respect
prefers-reduced-motion (disable transforms, keep opacity).

### 4.12 Accessibility
Text contrast ≥ 4.5:1 (palette verified), visible focus everywhere, full keyboard nav,
aria-labels on icon buttons, landmarks (header, nav, main, footer), skip-to-content link.

### 4.13 Component usage rule
Pages and feature components NEVER pass color, radius, height, or font-size classes to
Button/Input/Badge/Card. They choose `variant` and `size` only. If a new look is needed,
add a variant in the shared component and document it in DESIGN.md first.

---

## Implementation map

| Rule | Where it lives |
| --- | --- |
| Tokens (colour, radius, shadow, motion, type, widths) | `app/globals.css` (`:root,.dark` → `.light` → `@theme inline` → `@layer base`) |
| TS mirror | `lib/brand.ts` (`brand.dark`, `brand.light`, `.colors`, `.chart`) |
| Utilities | `rounded-control`, `rounded-surface`, `shadow-float`, `duration-fast`, `duration-base`, `ease-out`, `text-page-title`, `text-section-title`, `text-body`, `text-meta`, `text-label`, `text-mono`, `max-w-page`, `max-w-form`, `text-link`, `bg-primary-hover`, `*-success`, `*-warning` |
| Theme variant | `light:` (beige) and `dark:` custom variants |
| Shared components | `components/ui/*` — each file starts with a when-to-use JSDoc |
| App shell | `components/layout/*` |

### Component vocabulary
- `Button` — `variant` primary | secondary (default) | ghost | destructive | link;
  `size` sm | md (default) | lg | icon | icon-sm | icon-lg; `loading`, `leftIcon`.
- `Input` / `Textarea` / `SelectTrigger` — `size` sm | md | lg, `error`.
- `FormField` (`components/ui/form-field.tsx`) — the only way forms render a field.
  Label, control (render function receives `id`/aria props), helper ↔ error, counter
  with `mode` chars (graphemes) | bytes (UTF-8) | weighted (`weigh` fn).
  It is named `FormField` because shadcn's low-level `Field` primitives already use
  the name `Field`.
- `Badge` — neutral | primary | success | warning | destructive | outline.
- `StatusBadge` — published, connected, processing, expiring, failed, reconnect, pending.
- `Card` (+ Header/Title/Description/Action/Content/Footer), `Alert` (info | success |
  warning | destructive), `Dialog`, `ConfirmDialog`, `DropdownMenu`, `Tooltip`, `Tabs`,
  `Switch`, `Separator`, `Skeleton`, `Toaster` (sonner), `EmptyState`, `PageHeader`.

### Clarifications (where the palette forced a decision)
- **Ghost hover in dark.** Dark `--muted` (#151520) is identical to `--card`, so a
  `bg-muted` hover is invisible on cards. Ghost hover is `bg-muted` in light and
  `bg-popover` in dark.
- **Sidebar active/hover** use `--sidebar-accent` (dark #1C1C2A, light = muted #EFE8DA)
  for the same reason, plus the 2px primary indicator.
- **Skeleton** uses the `border` tone so it shows on both background and card in both themes.
- **Button loading without a leading icon.** There is no icon to swap, so the label stays
  in the layout (transparent, still read by screen readers) and a spinner is centred over
  it. Width is unchanged. Prefer `leftIcon` on buttons that can load.
- **Tooltip** is a floating layer: `bg-popover` + border + `shadow-float`, radius-control.
- **Dialog overlay** is `bg-background/70` + blur. No raw black.
- **Popups** (select, dropdown, menubar, context menu, combobox) used shadcn's
  "inverted" style, which forced `.dark` on them. That was removed, so they follow the
  active theme.

## Exceptions to the lint rules
None are expected. If one is truly needed, add the file's repo-relative path and a
reason to `ALLOWLIST` in `scripts/lint-design.mjs`. The PR must explain why a shared
component variant can't do the job, and design review must approve it.
