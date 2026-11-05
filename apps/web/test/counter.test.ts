import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
    countBytes,
    countChars,
    countText,
    counterTone,
} from '../lib/counter.ts'

test('chars counts grapheme clusters (Bengali conjuncts, emoji)', () => {
    assert.equal(countChars('hello'), 5)
    assert.equal(countChars('👍🏽'), 1)
    assert.equal(countChars('ক্ষ'), 1) // one conjunct cluster, 3 code points
})

test('bytes counts UTF-8', () => {
    assert.equal(countBytes('abc'), 3)
    assert.equal(countBytes('বাংলা'), 15) // 5 code points × 3 bytes
})

test('weighted uses the provided fn', () => {
    assert.equal(
        countText('abc', 'weighted', (v) => v.length * 2),
        6
    )
    assert.throws(() => countText('abc', 'weighted'))
})

test('tone: warning at ≥90%, destructive when over', () => {
    assert.equal(counterTone(89, 100), 'muted')
    assert.equal(counterTone(90, 100), 'warning')
    assert.equal(counterTone(100, 100), 'warning')
    assert.equal(counterTone(101, 100), 'destructive')
})
