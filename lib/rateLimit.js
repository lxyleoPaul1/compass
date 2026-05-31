// 简单内存速率限制（单进程）。生产多实例时需换 Redis 等。

const buckets = new Map();

function getBucket(key, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  return b;
}

/** 只检查是否超限，不增加计数 */
export function peekRateLimit(key, { windowMs = 60000, max = 10 } = {}) {
  const b = getBucket(key, windowMs);
  if (b.count >= max) {
    const retryAfter = Math.ceil((b.start + windowMs - Date.now()) / 1000);
    return { ok: false, retryAfter };
  }
  return { ok: true };
}

/** 增加计数并检查是否超限 */
export function rateLimit(key, { windowMs = 60000, max = 10 } = {}, increment = 1) {
  const b = getBucket(key, windowMs);
  b.count += increment;
  if (b.count > max) {
    const retryAfter = Math.ceil((b.start + windowMs - Date.now()) / 1000);
    return { ok: false, retryAfter };
  }
  return { ok: true };
}

// 定期清理过期 bucket
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 3600000) buckets.delete(k);
  }
}, 600000).unref?.();
