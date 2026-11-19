/** Настройка тестов: полифилл IndexedDB и localStorage для node-окружения. */
import "fake-indexeddb/auto";

// Node 22 предоставляет globalThis.crypto (WebCrypto) из коробки.

// Минимальный in-memory localStorage.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
}
