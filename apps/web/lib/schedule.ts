/** Scheduling helpers for the composer and batch page (times are sent as ISO + IANA timezone). */

export type Schedule = { at: string; timezone: string }

export const browserTimezone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
        return 'UTC'
    }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO → value for <input type="datetime-local"> (browser's local time). */
export function toLocalInput(iso: string | Date): string {
    const d = new Date(iso)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local value (browser local time) → ISO UTC, or null when empty/invalid. */
export function fromLocalInput(value: string): string | null {
    if (!value) return null
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Earliest allowed time: now + 2 min (rounded up to the next minute) as a datetime-local value. */
export const minLocalInput = () => toLocalInput(new Date(Math.ceil((Date.now() + 2 * 60_000) / 60_000) * 60_000))

/** "7 Nov, 7:00 PM IST" in the schedule's own timezone. */
export function formatScheduled(iso: string | Date, timezone: string): string {
    const d = new Date(iso)
    try {
        const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: timezone }).format(d)
        const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(d)
        return `${date}, ${time}`
    } catch {
        return d.toLocaleString()
    }
}

/** Client-side mirror of the server rule (≥ 2 min, ≤ 180 days). */
export function scheduleIssue(iso: string | null, now = Date.now()): string | null {
    if (!iso) return null
    const t = Date.parse(iso)
    if (t < now + 2 * 60_000) return 'Schedule at least 2 minutes from now'
    if (t > now + 180 * 24 * 60 * 60_000) return 'Schedule at most 180 days ahead'
    return null
}
