import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lintSource } from '../scripts/lint-design.mjs'

const rulesHit = (src: string) => lintSource(src).map((p) => p.rule)

test('flags colour literals', () => {
    assert.deepEqual(rulesHit(`const c = '#4F46E5'`), ['color-literal'])
    assert.deepEqual(rulesHit(`style={{ color: 'rgb(0 0 0)' }}`), [
        'color-literal',
    ])
    assert.deepEqual(rulesHit(`<a href="#content">`), [])
})

test('flags palette classes', () => {
    assert.deepEqual(rulesHit(`<div className="bg-indigo-600" />`), [
        'palette-class',
    ])
    assert.deepEqual(rulesHit(`<p className="hover:text-gray-500" />`), [
        'palette-class',
    ])
    assert.deepEqual(rulesHit(`<p className="text-muted-foreground" />`), [])
})

test('flags arbitrary values', () => {
    assert.deepEqual(rulesHit(`<div className="rounded-[6px]" />`), [
        'arbitrary-value',
    ])
    assert.deepEqual(rulesHit(`<div className="h-[37px] p-[3px]" />`), [
        'arbitrary-value',
        'arbitrary-value',
    ])
    assert.deepEqual(rulesHit(`<div className="text-[15px]" />`), [
        'arbitrary-value',
    ])
    assert.deepEqual(rulesHit(`<div className="gap-4 p-6" />`), [])
})

test('flags style overrides on shared controls, allows layout', () => {
    assert.deepEqual(
        rulesHit(
            `<Button variant="primary" className="bg-primary rounded-full" onClick={() => x > 1}>Go</Button>`
        ),
        ['control-override', 'control-override']
    )
    assert.deepEqual(
        rulesHit(`<Input className={cn('h-12', ok && 'w-full')} />`),
        ['control-override']
    )
    assert.deepEqual(rulesHit(`<Badge className="text-sm">x</Badge>`), [
        'control-override',
    ])
    assert.deepEqual(
        rulesHit(`<Card className="w-full md:col-span-2 text-center">x</Card>`),
        []
    )
    assert.deepEqual(rulesHit(`<CardContent className="bg-muted" />`), [])
})
