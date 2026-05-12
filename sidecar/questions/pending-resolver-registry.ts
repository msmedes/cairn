type PendingEntry<T> = {
  resolve: (result: T) => void;
  reject: (error: Error) => void;
};

export class PendingResolverRegistry<T> {
  readonly #pending = new Map<string, PendingEntry<T>>();

  registerPending(id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  resolvePending(id: string, result: T): boolean {
    const entry = this.#pending.get(id);
    if (!entry) return false;

    this.#pending.delete(id);
    entry.resolve(result);
    return true;
  }

  cancelAllPending(reason: string) {
    const error = new Error(reason);
    for (const [id, entry] of this.#pending) {
      this.#pending.delete(id);
      entry.reject(error);
    }
  }
}
