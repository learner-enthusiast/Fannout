import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { brand, colorTokenNames } from '../lib/brand.ts'

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

/** Extract `--name: value;` pairs from the first block whose selector matches. */
function block(selector: RegExp): Record<string, string> {
    const match = selector.exec(css)
    assert.ok(match, `block ${selector} not found in globals.css`)
    const start = css.indexOf('{', match.index) + 1
    const end = css.indexOf('\n}', start)
    const vars: Record<string, string> = {}
    for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
        vars[m[1]!] = m[2]!.trim()
    }
    return vars
}

const themes = {
    dark: block(/^:root,\s*\n\.dark\s*\{/m),
    light: block(/^\.light\s*\{/m),
}

for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: every brand.ts colour matches globals.css`, () => {
        for (const name of colorTokenNames) {
            const cssValue = themes[theme][name]
            assert.ok(cssValue, `--${name} missing from .${theme} block`)
            assert.equal(
                cssValue.toLowerCase(),
                brand[theme][name].toLowerCase(),
                `--${name} (${theme})`
            )
        }
    })

    test(`${theme}: globals.css has no colour token that brand.ts lacks`, () => {
        const extra = Object.keys(themes[theme]).filter(
            (k) =>
                themes[theme][k]!.startsWith('#') &&
                !(colorTokenNames as readonly string[]).includes(k)
        )
        assert.deepEqual(extra, [])
    })

    test(`${theme}: ordered arrays follow the token list`, () => {
        assert.deepEqual(
            brand[theme].colors,
            colorTokenNames.map((n) => brand[theme][n])
        )
        assert.deepEqual(brand[theme].chart, [
            brand[theme].primary,
            brand[theme].accent,
            brand[theme].success,
            brand[theme].warning,
            brand[theme].destructive,
        ])
    })
}

test('shared radius and motion tokens match', () => {
    const shared = block(/^:root\s*\{/m)
    assert.equal(shared['radius-control'], `${brand.radius.control}px`)
    assert.equal(shared['radius-surface'], `${brand.radius.surface}px`)
    assert.equal(shared['duration-fast'], `${brand.duration.fast}ms`)
    assert.equal(shared['duration-base'], `${brand.duration.base}ms`)
    assert.match(css, /--ease-out: cubic-bezier\(0\.2, 0\.8, 0\.2, 1\);/)
})
