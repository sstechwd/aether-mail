/** At most a handful of secrets, LRU, never written to disk. */
export class SecretVault {
  private order: string[] = [];
  private values = new Map<string, string>();

  constructor(private readonly max = 8) {}

  put(ref: string, secret: string): void {
    this.values.set(ref, secret);
    this.order = this.order.filter((k) => k !== ref);
    this.order.push(ref);
    while (this.order.length > this.max) {
      const drop = this.order.shift();
      if (drop) this.values.delete(drop);
    }
  }

  has(ref: string): boolean {
    return this.values.has(ref);
  }

  get(ref: string): string | undefined {
    return this.values.get(ref);
  }

  delete(ref: string): void {
    this.values.delete(ref);
    this.order = this.order.filter((k) => k !== ref);
  }

  get size(): number {
    return this.values.size;
  }
}
