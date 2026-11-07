/** Shallow copy without the given keys. */
export function omit<T extends Record<string, unknown>, K extends string>(value: T, ...keys: K[]): Omit<T, K> {
  const copy: Record<string, unknown> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}
