/** Classic token bucket; time comes from the caller. */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + (Math.max(0, now - this.updatedAt) / 1000) * this.refillPerSecond);
    this.updatedAt = Math.max(this.updatedAt, now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** One token bucket per key (user id, IP, ...). */
export class KeyedRateLimiter<K extends string | number> {
  private buckets = new Map<K, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: K): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.perSecond, this.now());
      this.buckets.set(key, bucket);
    }
    return bucket.take(this.now());
  }
}

/** One token bucket per user id. */
export class UserRateLimiter extends KeyedRateLimiter<number> {}
