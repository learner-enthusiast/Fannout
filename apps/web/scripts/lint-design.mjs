#!/usr/bin/env node
/**
 * Design-rule lint (DESIGN.md §4 / task §7). Runs in `pnpm lint` (turbo) and CI.
 *
 * Scans .ts/.tsx/.js/.jsx/.mjs files in app/ and components/ (excluding
 * components/ui, where tokens are applied) and fails on:
 *   1. hex / rgb() / hsl() / oklch() colour literals
 *   2. Tailwind palette colour classes (bg-indigo-600, text-gray-500, …)
 *   3. arbitrary values: rounded-[…], h-[…], text-[…px], p*-[…], m*-[…], gap-[…]
 *   4. colour / radius / height / font-size classes passed via className to
 *      Button, Input, Textarea, SelectTrigger, Badge or Card
 *
 * Exceptions: add a repo-relative path + reason to ALLOWLIST (none expected;
 * see DESIGN.md → "Exceptions to the lint rules").
 *
 * Usage: node scripts/lint-design.mjs [files…]   (no args = scan the tree)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {Record<string, string>} path (relative to apps/web) → reason */
const ALLOWLIST = {}

const SCAN_DIRS = ['app', 'components']
const EXCLUDE_DIRS = [join('components', 'ui')]
const EXTENSIONS = /\.(tsx?|jsx?|mjs)$/

const PALETTE =
    'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

/** @type {{ id: string, message: string, re: RegExp, filter?: (match: string) => boolean }[]} */
export const rules = [
    {
        id: 'color-literal',
        message: 'raw colour literal — use a semantic token utility',
        re: /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(/g,
    },
    {
        id: 'palette-class',
        message: 'Tailwind palette colour class — use a semantic token',
        re: new RegExp(
            `(?<![\\w-])(?:[\\w-]+:)*(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:${PALETTE})-\\d+\\b`,
            'g'
        ),
    },
    {
        id: 'arbitrary-value',
        message: 'arbitrary value — use the 4px scale / design tokens',
        re: /(?<![\w-])(?:[\w-]+:)*-?(?:rounded(?:-[a-z]{1,2})?|h|text|p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?)-\[[^\]]*\]/g,
        // text-[…] is only banned for sizes (px/rem); text-[var(--x)] colours are caught elsewhere
        /** @param {string} match */
        filter: (match) =>
            !/^(?:[\w-]+:)*text-\[/.test(match) ||
            /\d(?:px|rem|em)\]$/.test(match),
    },
]

const CONTROLS = [
    'Button',
    'Input',
    'Textarea',
    'SelectTrigger',
    'Badge',
    'Card',
]
const ALIGN_TEXT =
    /^text-(?:left|center|right|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip)$/
const STYLE_UTILITY =
    /^(?:bg-|text-|border-(?!0$|[xytblrse]$|[xytblrse]-0$|solid|dashed|dotted|none)|rounded|h-|min-h-|max-h-|size-|ring-|fill-|stroke-|shadow-|leading-|font-(?:thin|light|normal|medium|semibold|bold|black))/

/** @param {string} src @param {number} index */
function lineOf(src, index) {
    return src.slice(0, index).split('\n').length
}

/** Find the end of a JSX opening tag starting at `start`, honouring {…} and quotes. */
/** @param {string} src @param {number} start */
function tagEnd(src, start) {
    let depth = 0
    /** @type {string | null} */
    let quote = null
    for (let i = start; i < src.length; i++) {
        const c = src[i]
        if (quote) {
            if (c === '\\') i++
            else if (c === quote) quote = null
            continue
        }
        if (c === '"' || c === "'" || c === '`') quote = c
        else if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) return i
    }
    return src.length
}

/** @param {string} attrs @returns {string[]} */
function classNameStrings(attrs) {
    const m = /\bclassName\s*=\s*/.exec(attrs)
    if (!m) return []
    const rest = attrs.slice(m.index + m[0].length)
    let value
    if (rest[0] === '"' || rest[0] === "'") {
        value = rest.slice(0, rest.indexOf(rest[0], 1) + 1)
    } else if (rest[0] === '{') {
        let depth = 0
        let end = 0
        for (; end < rest.length; end++) {
            if (rest[end] === '{') depth++
            else if (rest[end] === '}' && --depth === 0) break
        }
        value = rest.slice(0, end + 1)
    } else return []
    return [...value.matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map(
        (s) => s[2] ?? ''
    )
}

/**
 * @param {string} src
 * @param {string} [file]
 * @returns {{ file: string, line: number, rule: string, message: string }[]}
 */
export function lintSource(src, file = '<input>') {
    /** @type {{ file: string, line: number, rule: string, message: string }[]} */
    const problems = []
    for (const rule of rules) {
        for (const match of src.matchAll(rule.re)) {
            if (rule.filter && !rule.filter(match[0])) continue
            problems.push({
                file,
                line: lineOf(src, match.index),
                rule: rule.id,
                message: `${rule.message}: ${match[0]}`,
            })
        }
    }
    const tagRe = new RegExp(`<(${CONTROLS.join('|')})(?=[\\s/>])`, 'g')
    for (const match of src.matchAll(tagRe)) {
        const start = match.index + match[0].length
        const attrs = src.slice(start, tagEnd(src, start))
        for (const str of classNameStrings(attrs)) {
            for (const cls of str.split(/\s+/).filter(Boolean)) {
                const bare = cls
                    .replace(/^(?:[\w\-[\]&:@*/.]+:)+/, '')
                    .replace(/^!|!$/g, '')
                if (ALIGN_TEXT.test(bare)) continue
                if (STYLE_UTILITY.test(bare)) {
                    problems.push({
                        file,
                        line: lineOf(src, match.index),
                        rule: 'control-override',
                        message: `<${match[1]} className> sets "${cls}" — choose a variant/size instead`,
                    })
                }
            }
        }
    }
    return problems
}

/** @param {string} dir @param {string[]} out @returns {string[]} */
function walk(dir, out) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const rel = relative(root, full)
        if (EXCLUDE_DIRS.some((ex) => rel === ex || rel.startsWith(ex + sep)))
            continue
        if (statSync(full).isDirectory()) walk(full, out)
        else if (EXTENSIONS.test(name)) out.push(full)
    }
    return out
}

const isMain =
    process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
    const args = process.argv.slice(2)
    const files = args.length
        ? args.map((f) => join(process.cwd(), f))
        : SCAN_DIRS.flatMap((d) => walk(join(root, d), []))
    const problems = files
        .filter((f) => !ALLOWLIST[relative(root, f)])
        .flatMap((f) => lintSource(readFileSync(f, 'utf8'), relative(root, f)))
    for (const p of problems) {
        console.error(`${p.file}:${p.line}  ${p.rule}  ${p.message}`)
    }
    if (problems.length) {
        console.error(
            `\n✖ ${problems.length} design-rule problem(s). See apps/web/DESIGN.md.`
        )
        process.exit(1)
    }
    console.log(`✔ design rules: ${files.length} files clean`)
}
