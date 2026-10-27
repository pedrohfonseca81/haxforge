// A value that UI components can watch (see useStore).
import { useEffect, useState } from "preact/hooks";

export class Store<T> {
  private listeners = new Set<(v: T) => void>();

  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(value: T): void {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const l of this.listeners) l(value);
  }

  update(patch: Partial<T>): void {
    this.set({ ...this.value, ...patch });
  }

  subscribe(fn: (v: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => {
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store]);
  return value;
}
