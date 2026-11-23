const memoryFallbackMap = new Map();

function getRedisCredentials() {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ''
  ).trim();
  if (!url || !token) return null;
  return { url, token };
}

export function isSharedCooldownEnabled() {
  return Boolean(getRedisCredentials());
}

async function hashApiKey(key) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = new TextEncoder().encode(`adam-studio:cd:${key}`);
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv-${(h >>> 0).toString(16)}-${key.length}`;
}

async function runRedisCommand(commandArgs, timeoutMs = 1300) {
  const creds = getRedisCredentials();
  if (!creds) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(creds.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commandArgs),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function recordKeyCooldown(key, durationMs, localMap = memoryFallbackMap) {
  if (!key) return;
  const ttlSec = Math.max(5, Math.ceil(durationMs / 1000));
  const coolUntil = Date.now() + ttlSec * 1000;
  localMap.set(key, coolUntil);

  if (!isSharedCooldownEnabled()) return;
  const hashed = await hashApiKey(key);
  await runRedisCommand(['SET', `adam:keycd:${hashed}`, String(coolUntil), 'EX', ttlSec]);
}

export async function hydrateKeyCooldowns(keys = [], localMap = memoryFallbackMap) {
  if (!Array.isArray(keys) || keys.length === 0) return;
  if (!isSharedCooldownEnabled()) return;

  const hashes = await Promise.all(keys.map((k) => hashApiKey(k)));
  const redisKeys = hashes.map((h) => `adam:keycd:${h}`);
  const result = await runRedisCommand(['MGET', ...redisKeys]);
  if (!Array.isArray(result)) return;

  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const rawVal = result[i];
    const remoteUntil = rawVal ? Number(rawVal) : 0;
    const localUntil = localMap.get(keys[i]) || 0;
    if (Number.isFinite(remoteUntil) && remoteUntil > now && remoteUntil > localUntil) {
      localMap.set(keys[i], remoteUntil);
    } else if (remoteUntil <= now && localUntil <= now && localMap.has(keys[i])) {
      localMap.delete(keys[i]);
    }
  }
}
