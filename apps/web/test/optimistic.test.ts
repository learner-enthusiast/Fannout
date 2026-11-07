import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'

import { removeFromInfiniteCache, restoreSnapshot, updateCache } from '../lib/optimistic.ts'

type Item = { id: string }
const pages = (...groups: string[][]) => ({
    pages: groups.map((ids, i) => ({ items: ids.map((id) => ({ id })), nextCursor: i < groups.length - 1 ? `c${i}` : null })),
    pageParams: groups.map((_, i) => (i === 0 ? null : `c${i - 1}`)),
})

test('removeFromInfiniteCache removes the item from every page of every matching query, restore undoes it', () => {
    const qc = new QueryClient()
    const library = [['media', 'list'], { input: { limit: 10 }, type: 'infinite' }]
    const filtered = [['media', 'list'], { input: { limit: 10, type: 'image' }, type: 'infinite' }]
    const other = [['folders', 'list'], { input: {}, type: 'infinite' }]
    qc.setQueryData(library, pages(['a', 'b', 'x'], ['c', 'x2'], ['x', 'd']))
    qc.setQueryData(filtered, pages(['x'], ['e']))
    qc.setQueryData(other, pages(['x']))

    const snapshot = removeFromInfiniteCache<Item>(qc, [['media', 'list']], (item) => item.id === 'x')
    assert.equal(snapshot.length, 2, 'both media.list queries, not folders')
    const ids = (key: unknown[]) => (qc.getQueryData(key) as ReturnType<typeof pages>).pages.map((p) => p.items.map((i) => i.id))
    assert.deepEqual(ids(library), [['a', 'b'], ['c', 'x2'], ['d']])
    assert.deepEqual(ids(filtered), [[], ['e']])
    assert.deepEqual(ids(other), [['x']], 'unrelated list untouched')
    assert.equal((qc.getQueryData(library) as ReturnType<typeof pages>).pages[0]!.nextCursor, 'c0', 'cursors kept')

    restoreSnapshot(qc, snapshot)
    assert.deepEqual(ids(library), [['a', 'b', 'x'], ['c', 'x2'], ['x', 'd']])
    assert.deepEqual(ids(filtered), [['x'], ['e']])
})

test('updateCache adjusts counts in detail queries and restores', () => {
    const qc = new QueryClient()
    const key = [['folders', 'get'], { input: { folderId: 'f1' }, type: 'query' }]
    qc.setQueryData(key, { id: 'f1', itemCount: 3 })
    const snapshot = updateCache<{ itemCount: number }>(qc, [['folders', 'get']], (d) => ({ ...d, itemCount: d.itemCount - 1 }))
    assert.equal((qc.getQueryData(key) as { itemCount: number }).itemCount, 2)
    restoreSnapshot(qc, snapshot)
    assert.equal((qc.getQueryData(key) as { itemCount: number }).itemCount, 3)
})
