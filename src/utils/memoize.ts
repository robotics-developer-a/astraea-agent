// Promise-level memoization: caches the Promise itself, not the resolved value.
// This prevents the race condition where two concurrent callers both see the
// cache as empty and both kick off the underlying async I/O.
export function memoize<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  const cache = new Map<string, Promise<R>>()
  return (...args: A): Promise<R> => {
    const key = JSON.stringify(args)
    if (!cache.has(key)) {
      cache.set(key, fn(...args))
    }
    return cache.get(key)!
  }
}
