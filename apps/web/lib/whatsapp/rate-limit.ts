/**
 * Token bucket sencillo para respetar el rate limit de Cloud API
 * (80 mensajes/segundo por phone_number_id por defecto).
 *
 * In-memory por instancia: en deploys serverless (Vercel) puede no ser
 * globalmente exacto, pero en cada lambda warm el bucket protege de bursts.
 * Para precisión cross-region usar Redis (a futuro).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    public readonly capacity: number,
    public readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /** Toma 1 token. Si no hay disponible, espera lo necesario. */
  async take(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const wait = Math.max(10, Math.ceil(1000 / this.refillPerSecond));
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
  }
}
