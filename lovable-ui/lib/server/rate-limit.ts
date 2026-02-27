type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

const cleanupBuckets = (now: number) => {
  if (buckets.size <= MAX_BUCKETS) return;
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  });
};

export const rateLimit = (key: string, options: RateLimitOptions) => {
  const now = Date.now();
  cleanupBuckets(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + options.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      limited: false,
      limit: options.limit,
      remaining: options.limit - 1,
      resetAt,
    } satisfies RateLimitResult;
  }

  if (existing.count >= options.limit) {
    return {
      limited: true,
      limit: options.limit,
      remaining: 0,
      resetAt: existing.resetAt,
    } satisfies RateLimitResult;
  }

  existing.count += 1;
  return {
    limited: false,
    limit: options.limit,
    remaining: Math.max(options.limit - existing.count, 0),
    resetAt: existing.resetAt,
  } satisfies RateLimitResult;
};

export const applyRateLimitHeaders = (
  headers: Headers,
  result: RateLimitResult,
) => {
  headers.set("RateLimit-Limit", result.limit.toString());
  headers.set("RateLimit-Remaining", result.remaining.toString());
  headers.set("RateLimit-Reset", Math.ceil(result.resetAt / 1000).toString());
};
