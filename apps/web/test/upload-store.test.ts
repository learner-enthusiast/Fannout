import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createUploadStore, selectStructure } from '../components/uploads/upload-store.ts'

const item = (id: string) => ({ id, name: id, size: 10, kind: 'video' as const, status: 'uploading' as const, progress: 0 })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('progress ticks are coalesced to at most ~5 notifications per second', async () => {
    const store = createUploadStore()
    store.update(() => [item('a')])
    let notified = 0
    store.subscribe(() => notified++)
    for (let i = 1; i <= 100; i++) store.setProgress('a', i / 100)
    assert.equal(notified, 0, 'nothing is emitted synchronously')
    await wait(260)
    assert.equal(notified, 1, 'one flush for the whole burst')
    assert.equal(store.get()[0]!.progress, 1)
})

test('a status change applies pending progress and notifies immediately', () => {
    const store = createUploadStore()
    store.update(() => [item('a')])
    store.setProgress('a', 0.5)
    store.update((items) => items.map((i) => ({ ...i, status: 'processing' as const })))
    assert.equal(store.get()[0]!.progress, 0.5)
    assert.equal(store.get()[0]!.status, 'processing')
})

test('structure selector ignores progress but changes with status', async () => {
    const store = createUploadStore()
    store.update(() => [item('a')])
    const before = selectStructure(store.get())
    store.setProgress('a', 0.9)
    await wait(260)
    assert.equal(selectStructure(store.get()), before)
    store.update((items) => items.map((i) => ({ ...i, status: 'ready' as const })))
    assert.notEqual(selectStructure(store.get()), before)
})
