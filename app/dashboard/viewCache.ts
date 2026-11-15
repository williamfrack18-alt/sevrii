// What each panel section last loaded, kept while the dashboard is open, so
// going back to a section shows it at once (and refreshes behind). Hovering a
// menu item starts its load early.

const data = new Map<string, unknown>();
const flight = new Map<string, Promise<unknown>>();

export function cachedView<T>(key: string): T | null {
  return (data.get(key) as T | undefined) ?? null;
}

export function putView<T>(key: string, value: T): void {
  data.set(key, value);
}

// One request at a time per key: a hover and the section opening share it.
export function loadView<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = flight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn()
    .then((v) => {
      data.set(key, v);
      return v;
    })
    .finally(() => flight.delete(key));
  flight.set(key, p);
  return p;
}
