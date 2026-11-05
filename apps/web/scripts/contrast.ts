/**
 * WCAG 2.x contrast check for every foreground/background token pair used by
 * DESIGN.md §4, in both themes. Fails (exit 1) if text < 4.5:1 or a UI
 * element (focus ring, filled control, status icon) < 3:1.
 *
 * Usage: node scripts/contrast.ts [--markdown]
 */
import { brand, type ThemeName, type ThemeColors } from '../lib/brand.ts'

type Kind = 'text' | 'ui' | 'info'
type Pair = { fg: string; bg: string; kind: Kind; use: string }

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
    ]
}

/** Alpha-composite `top` at `alpha` over `bottom` (how bg-x/10 renders). */
export function mix(top: string, alpha: number, bottom: string): string {
    const a = hexToRgb(top)
    const b = hexToRgb(bottom)
    return (
        '#' +
        a
            .map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)))
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')
    )
}

function luminance(hex: string) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string) {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
        number,
        number,
    ]
    return (l1 + 0.05) / (l2 + 0.05)
}

function pairs(): Pair[] {
    const surfaces = ['background', 'card', 'popover'] as const
    const list: Pair[] = []
    for (const s of surfaces) {
        list.push({ fg: 'foreground', bg: s, kind: 'text', use: 'body text' })
        list.push({
            fg: 'muted-foreground',
            bg: s,
            kind: 'text',
            use: 'meta / helper text',
        })
        list.push({ fg: 'link', bg: s, kind: 'text', use: 'link' })
        for (const st of ['success', 'warning', 'destructive'] as const) {
            list.push({
                fg: st,
                bg: s,
                kind: 'text',
                use: `${st} text (alert, error, counter)`,
            })
        }
        list.push({ fg: 'ring', bg: s, kind: 'ui', use: 'focus ring' })
        // Button fills are identified by their label (checked above), so the
        // fill-vs-surface ratio is informational only (WCAG 1.4.11).
        list.push({
            fg: 'primary',
            bg: s,
            kind: 'info',
            use: 'primary button fill edge (label carries it)',
        })
        list.push({
            fg: 'border',
            bg: s,
            kind: 'info',
            use: 'border / input edge (decorative)',
        })
    }
    list.push({
        fg: 'foreground',
        bg: 'muted',
        kind: 'text',
        use: 'text on muted (ghost hover)',
    })
    list.push({
        fg: 'muted-foreground',
        bg: 'muted',
        kind: 'text',
        use: 'neutral badge',
    })
    list.push({
        fg: 'primary-foreground',
        bg: 'primary',
        kind: 'text',
        use: 'primary button',
    })
    list.push({
        fg: 'primary-foreground',
        bg: 'primary-hover',
        kind: 'text',
        use: 'primary button hover',
    })
    list.push({
        fg: 'secondary-foreground',
        bg: 'secondary',
        kind: 'text',
        use: 'secondary surface',
    })
    list.push({
        fg: 'accent-foreground',
        bg: 'accent',
        kind: 'text',
        use: 'accent fill',
    })
    list.push({
        fg: 'success-foreground',
        bg: 'success',
        kind: 'text',
        use: 'success fill',
    })
    list.push({
        fg: 'warning-foreground',
        bg: 'warning',
        kind: 'text',
        use: 'warning fill',
    })
    list.push({
        fg: 'destructive-foreground',
        bg: 'destructive',
        kind: 'text',
        use: 'destructive button',
    })
    list.push({
        fg: 'sidebar-foreground',
        bg: 'sidebar',
        kind: 'text',
        use: 'sidebar text',
    })
    list.push({
        fg: 'sidebar-foreground',
        bg: 'sidebar-accent',
        kind: 'text',
        use: 'sidebar active item',
    })
    list.push({
        fg: 'muted-foreground',
        bg: 'sidebar',
        kind: 'text',
        use: 'sidebar idle item',
    })
    list.push({
        fg: 'sidebar-primary',
        bg: 'sidebar-accent',
        kind: 'ui',
        use: 'sidebar active indicator',
    })
    list.push({
        fg: 'primary-foreground',
        bg: 'primary',
        kind: 'ui',
        use: 'switch thumb (on)',
    })
    list.push({
        fg: 'foreground',
        bg: 'input',
        kind: 'ui',
        use: 'switch thumb (off)',
    })
    list.push({
        fg: 'muted-foreground',
        bg: 'background',
        kind: 'ui',
        use: 'idle icons',
    })
    return list
}

/** Composited pairs: tinted badges (x/10 over card) and destructive hover (/90). */
function derived(c: ThemeColors) {
    const rows: {
        fg: string
        bg: string
        kind: Kind
        use: string
        fgHex: string
        bgHex: string
    }[] = []
    for (const st of ['success', 'warning', 'destructive'] as const) {
        for (const s of ['card', 'background'] as const) {
            rows.push({
                fg: st,
                bg: `${st}/10 on ${s}`,
                kind: 'text',
                use: `${st} badge`,
                fgHex: c[st],
                bgHex: mix(c[st], 0.1, c[s]),
            })
        }
    }
    rows.push({
        fg: 'destructive-foreground',
        bg: 'destructive/90 on background',
        kind: 'text',
        use: 'destructive button hover',
        fgHex: c['destructive-foreground'],
        bgHex: mix(c.destructive, 0.9, c.background),
    })
    return rows
}

const markdown = process.argv.includes('--markdown')
let failures = 0
const out: string[] = []
if (markdown) {
    out.push(
        '| theme | foreground | background | ratio | need | result | use |'
    )
    out.push('| --- | --- | --- | --- | --- | --- | --- |')
}
for (const theme of ['dark', 'light'] as ThemeName[]) {
    const c = brand[theme] as unknown as ThemeColors
    const rows = [
        ...pairs().map((p) => ({
            ...p,
            fgHex: c[p.fg as keyof ThemeColors],
            bgHex: c[p.bg as keyof ThemeColors],
        })),
        ...derived(c),
    ]
    for (const r of rows) {
        const ratio = contrast(r.fgHex, r.bgHex)
        const need = r.kind === 'text' ? 4.5 : r.kind === 'ui' ? 3 : 0
        const ok = ratio >= need
        if (!ok) failures++
        const result = r.kind === 'info' ? 'info' : ok ? 'pass' : 'FAIL'
        if (markdown) {
            out.push(
                `| ${theme} | ${r.fg} | ${r.bg} | ${ratio.toFixed(2)} | ${need || '—'} | ${result} | ${r.use} |`
            )
        } else {
            out.push(
                `${result.padEnd(4)}  ${theme.padEnd(5)} ${ratio.toFixed(2).padStart(5)}:1 (≥${need || '—'})  ${r.fg} on ${r.bg}  — ${r.use}`
            )
        }
    }
}
console.log(out.join('\n'))
if (failures) {
    console.error(`\n✖ ${failures} contrast failure(s)`)
    process.exit(1)
}
console.log('\n✔ all text ≥ 4.5:1 and UI ≥ 3:1')
