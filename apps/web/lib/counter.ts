/**
 * Text counters used by <FormField counter>. Pure functions — unit tested.
 */
export type CounterMode = 'chars' | 'bytes' | 'weighted'

let segmenter: Intl.Segmenter | undefined

/** User-perceived characters (grapheme clusters) — correct for Bengali, emoji. */
export function countChars(value: string): number {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(value)).length
}

/** UTF-8 byte length. */
export function countBytes(value: string): number {
    return new TextEncoder().encode(value).length
}

export function countText(
    value: string,
    mode: CounterMode,
    weigh?: (value: string) => number
): number {
    if (mode === 'bytes') return countBytes(value)
    if (mode === 'weighted') {
        if (!weigh) throw new Error('counter mode "weighted" needs a weigh fn')
        return weigh(value)
    }
    return countChars(value)
}

export type CounterTone = 'muted' | 'warning' | 'destructive'

/** ≥90% of the limit → warning, over the limit → destructive. */
export function counterTone(count: number, limit: number): CounterTone {
    if (count > limit) return 'destructive'
    if (count >= limit * 0.9) return 'warning'
    return 'muted'
}
