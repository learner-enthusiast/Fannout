/** One page of results with the cursor needed to fetch the next one. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor?: string | null;
  /** Total count when the provider reports one. */
  total?: number | null;
}

export interface PaginateOptions {
  /** Stop after this many pages (default: unlimited). */
  maxPages?: number;
  /** Stop after this many items (default: unlimited). */
  maxItems?: number;
}

/**
 * Iterate items across pages for providers without SDK pagination helpers.
 * `fetchPage(undefined)` fetches the first page.
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  let pages = 0;
  let items = 0;
  const seen = new Set<string>();
  while (true) {
    const page = await fetchPage(cursor);
    pages += 1;
    for (const item of page.items) {
      if (options.maxItems !== undefined && items >= options.maxItems) return;
      items += 1;
      yield item;
    }
    if (!page.nextCursor || seen.has(page.nextCursor)) return;
    if (options.maxPages !== undefined && pages >= options.maxPages) return;
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export async function collectAll<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

/** Offset-based (LinkedIn start/count) pages expressed as string cursors. */
export function nextOffsetCursor(start: number, count: number, returned: number, total?: number | null) {
  const next = start + returned;
  if (returned === 0 || returned < count) return null;
  if (total != null && next >= total) return null;
  return String(next);
}
