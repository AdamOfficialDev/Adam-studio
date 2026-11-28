const memoryFallbackMap = new Map();
const globalMetaMap = new Map();
const modelCooldownMap = new Map();

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

function normalizeModelName(model) {
  return String(model || '').trim().toLowerCase();
}

function getModelMapForKey(key, create = false) {
  let map = modelCooldownMap.get(key);
  if (!map && create) {
    map = new Map();
    modelCooldownMap.set(key, map);
  }
  return map || null;
}

function pruneExpiredModels(key, now = Date.now()) {
  const map = modelCooldownMap.get(key);
  if (!map) return;
  for (const [m, entry] of map.entries()) {
    if (!entry || entry.until <= now) {
      map.delete(m);
    }
  }
  if (map.size === 0) modelCooldownMap.delete(key);
}

function parseCooldownPayload(rawVal) {
  if (!rawVal) return null;
  if (typeof rawVal === 'number') {
    return Number.isFinite(rawVal) ? { until: rawVal, reason: 'rate_limit' } : null;
  }
  const str = String(rawVal).trim();
  if (!str) return null;
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }
  const num = Number(str);
  return Number.isFinite(num) && num > 0 ? { until: num, reason: 'rate_limit' } : null;
}

function buildRedisPayload(key, now = Date.now()) {
  pruneExpiredModels(key, now);
  const globalEntry = globalMetaMap.get(key);
  const modelMap = modelCooldownMap.get(key);
  const models = {};
  let maxUntil = globalEntry && globalEntry.until > now ? globalEntry.until : 0;

  if (modelMap) {
    for (const [m, entry] of modelMap.entries()) {
      if (entry && entry.until > now) {
        models[m] = entry;
        if (entry.until > maxUntil) maxUntil = entry.until;
      }
    }
  }

  if (maxUntil <= now) return null;

  return {
    ttlSec: Math.max(5, Math.ceil((maxUntil - now) / 1000)),
    payload: {
      until: globalEntry && globalEntry.until > now ? globalEntry.until : 0,
      reason: globalEntry?.reason,
      statusCode: globalEntry?.statusCode,
      message: globalEntry?.message,
      updatedAt: globalEntry?.updatedAt || now,
      models,
    },
  };
}

export async function recordKeyCooldown(key, durationMs, localMapOrMeta = memoryFallbackMap, maybeMeta) {
  if (!key) return;
  let localMap = memoryFallbackMap;
  let meta = {};

  if (localMapOrMeta instanceof Map) {
    localMap = localMapOrMeta;
    if (maybeMeta && typeof maybeMeta === 'object') meta = maybeMeta;
  } else if (localMapOrMeta && typeof localMapOrMeta === 'object') {
    meta = localMapOrMeta;
    if (maybeMeta instanceof Map) localMap = maybeMeta;
  }

  const now = Date.now();
  const ttlSec = Math.max(5, Math.ceil(durationMs / 1000));
  const coolUntil = now + ttlSec * 1000;

  const statusCode = Number.isFinite(Number(meta.statusCode)) ? Number(meta.statusCode) : undefined;
  const reason =
    meta.reason ||
    (statusCode === 401 || statusCode === 403
      ? 'invalid_key'
      : statusCode === 429
        ? 'rate_limit'
        : 'overload');
  const modelName = normalizeModelName(meta.model);
  const shortMsg =
    typeof meta.message === 'string' && meta.message.trim()
      ? meta.message.trim().slice(0, 180)
      : undefined;

  const isPerModel = reason === 'rate_limit' && Boolean(modelName) && meta.scope !== 'global';

  if (isPerModel) {
    const modelMap = getModelMapForKey(key, true);
    modelMap.set(modelName, {
      until: coolUntil,
      reason,
      statusCode,
      model: modelName,
      message: shortMsg,
      updatedAt: now,
    });
  } else {
    const entry = {
      until: coolUntil,
      reason,
      statusCode,
      model: modelName || undefined,
      message: shortMsg,
      updatedAt: now,
    };
    globalMetaMap.set(key, entry);
    memoryFallbackMap.set(key, coolUntil);
    if (localMap && localMap !== memoryFallbackMap) {
      localMap.set(key, coolUntil);
    }
  }

  if (!isSharedCooldownEnabled()) return;
  const hashed = await hashApiKey(key);
  const built = buildRedisPayload(key, now);
  if (!built) return;
  await runRedisCommand([
    'SET',
    `adam:keycd:${hashed}`,
    JSON.stringify(built.payload),
    'EX',
    built.ttlSec,
  ]);
}

export async function clearKeyCooldown(key, opts = {}, localMap = memoryFallbackMap) {
  if (!key) return;
  const now = Date.now();
  const onlyInvalid = Boolean(opts.onlyInvalid);
  const modelName = normalizeModelName(opts.model);

  if (modelName) {
    const modelMap = modelCooldownMap.get(key);
    if (modelMap) {
      modelMap.delete(modelName);
      if (modelMap.size === 0) modelCooldownMap.delete(key);
    }
  } else if (onlyInvalid) {
    const g = globalMetaMap.get(key);
    if (g && g.reason === 'invalid_key') {
      globalMetaMap.delete(key);
      memoryFallbackMap.delete(key);
      if (localMap && localMap !== memoryFallbackMap) localMap.delete(key);
    }
  } else {
    globalMetaMap.delete(key);
    modelCooldownMap.delete(key);
    memoryFallbackMap.delete(key);
    if (localMap && localMap !== memoryFallbackMap) localMap.delete(key);
  }

  if (!isSharedCooldownEnabled()) return;
  const hashed = await hashApiKey(key);
  const built = buildRedisPayload(key, now);
  if (!built) {
    await runRedisCommand(['DEL', `adam:keycd:${hashed}`]);
  } else {
    await runRedisCommand([
      'SET',
      `adam:keycd:${hashed}`,
      JSON.stringify(built.payload),
      'EX',
      built.ttlSec,
    ]);
  }
}

export async function clearAllKeyCooldowns(keys = [], localMap = memoryFallbackMap) {
  await Promise.all(keys.map((k) => clearKeyCooldown(k, {}, localMap)));
}

export async function hydrateKeyCooldowns(keys = [], localMap = memoryFallbackMap) {
  if (!Array.isArray(keys) || keys.length === 0) return;

  const now = Date.now();

  // Sinkronkan memory shared <-> localMap terlebih dahulu (penting saat Upstash Redis tidak aktif)
  for (const key of keys) {
    const sharedUntil = memoryFallbackMap.get(key) || 0;
    const localUntil = localMap.get(key) || 0;
    if (sharedUntil > now && sharedUntil > localUntil) {
      localMap.set(key, sharedUntil);
    } else if (localUntil > now && localUntil > sharedUntil) {
      memoryFallbackMap.set(key, localUntil);
      if (!globalMetaMap.has(key)) {
        globalMetaMap.set(key, { until: localUntil, reason: 'rate_limit', updatedAt: now });
      }
    } else if (sharedUntil <= now && localMap.has(key) && localUntil <= now) {
      localMap.delete(key);
    }
  }

  if (!isSharedCooldownEnabled()) return;

  const hashes = await Promise.all(keys.map((k) => hashApiKey(k)));
  const redisKeys = hashes.map((h) => `adam:keycd:${h}`);
  const result = await runRedisCommand(['MGET', ...redisKeys]);
  if (!Array.isArray(result)) return;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const parsed = parseCooldownPayload(result[i]);
    if (!parsed) continue;

    const remoteGlobalUntil = Number(parsed.until) || 0;
    const localUntil = Math.max(localMap.get(key) || 0, memoryFallbackMap.get(key) || 0);

    if (remoteGlobalUntil > now && remoteGlobalUntil >= localUntil) {
      memoryFallbackMap.set(key, remoteGlobalUntil);
      localMap.set(key, remoteGlobalUntil);
      globalMetaMap.set(key, {
        until: remoteGlobalUntil,
        reason: parsed.reason || 'rate_limit',
        statusCode: parsed.statusCode,
        model: parsed.model,
        message: parsed.message,
        updatedAt: parsed.updatedAt || now,
      });
    } else if (remoteGlobalUntil <= now && localUntil <= now) {
      memoryFallbackMap.delete(key);
      localMap.delete(key);
      globalMetaMap.delete(key);
    }

    if (parsed.models && typeof parsed.models === 'object') {
      const mMap = getModelMapForKey(key, true);
      for (const [mName, mEntry] of Object.entries(parsed.models)) {
        const normM = normalizeModelName(mName);
        const mUntil = Number(mEntry?.until) || 0;
        if (normM && mUntil > now) {
          const existing = mMap.get(normM);
          if (!existing || mUntil > existing.until) {
            mMap.set(normM, {
              until: mUntil,
              reason: mEntry.reason || 'rate_limit',
              statusCode: mEntry.statusCode,
              model: normM,
              message: mEntry.message,
              updatedAt: mEntry.updatedAt || now,
            });
          }
        }
      }
      pruneExpiredModels(key, now);
    }
  }
}

export function getKeyCooldownState(key, targetModel = '', localMap = memoryFallbackMap) {
  const now = Date.now();
  const normModel = normalizeModelName(targetModel);
  pruneExpiredModels(key, now);

  const gMeta = globalMetaMap.get(key);
  const fallbackUntil = Math.max(memoryFallbackMap.get(key) || 0, localMap?.get(key) || 0);
  const globalUntil = Math.max(gMeta?.until || 0, fallbackUntil);

  if (globalUntil > now) {
    const reason = gMeta?.reason || 'rate_limit';
    return {
      cooling: true,
      isInvalid: reason === 'invalid_key',
      until: globalUntil,
      remainingSec: Math.ceil((globalUntil - now) / 1000),
      reason,
      statusCode: gMeta?.statusCode,
      model: gMeta?.model,
      message: gMeta?.message,
    };
  }

  const mMap = modelCooldownMap.get(key);
  if (normModel && mMap) {
    const mEntry = mMap.get(normModel);
    if (mEntry && mEntry.until > now) {
      return {
        cooling: true,
        isInvalid: false,
        until: mEntry.until,
        remainingSec: Math.ceil((mEntry.until - now) / 1000),
        reason: mEntry.reason || 'rate_limit',
        statusCode: mEntry.statusCode,
        model: mEntry.model,
        message: mEntry.message,
      };
    }
  }

  return {
    cooling: false,
    isInvalid: false,
    until: 0,
    remainingSec: 0,
    reason: undefined,
    statusCode: undefined,
    model: undefined,
    message: undefined,
  };
}

export function getKeyStatusSnapshot(keys = [], targetModel = '', localMap = memoryFallbackMap) {
  const now = Date.now();
  const normTarget = normalizeModelName(targetModel);

  return keys.map((key, idx) => {
    const tail = key.length >= 4 ? key.slice(-4) : '****';
    const label = `Key #${idx + 1} (•••${tail})`;
    pruneExpiredModels(key, now);

    const gMeta = globalMetaMap.get(key);
    const fallbackUntil = Math.max(memoryFallbackMap.get(key) || 0, localMap?.get(key) || 0);
    const globalUntil = Math.max(gMeta?.until || 0, fallbackUntil);

    const mMap = modelCooldownMap.get(key);
    const cooldownModels = [];
    if (mMap) {
      for (const [mName, mEntry] of mMap.entries()) {
        if (mEntry && mEntry.until > now) {
          cooldownModels.push({
            model: mName,
            remainingSec: Math.ceil((mEntry.until - now) / 1000),
            reason: mEntry.reason || 'rate_limit',
            statusCode: mEntry.statusCode,
            message: mEntry.message,
          });
        }
      }
      cooldownModels.sort((a, b) => b.remainingSec - a.remainingSec);
    }

    if (globalUntil > now) {
      const reason = gMeta?.reason || 'rate_limit';
      const isInvalid = reason === 'invalid_key';
      return {
        index: idx,
        label,
        status: isInvalid ? 'invalid' : 'cooldown',
        cooldownRemainingSec: Math.ceil((globalUntil - now) / 1000),
        reason,
        statusCode: gMeta?.statusCode,
        model: gMeta?.model,
        message: gMeta?.message,
        cooldownModels: cooldownModels.length > 0 ? cooldownModels : undefined,
      };
    }

    if (normTarget) {
      const specific = cooldownModels.find((m) => m.model === normTarget);
      if (specific) {
        return {
          index: idx,
          label,
          status: 'cooldown',
          cooldownRemainingSec: specific.remainingSec,
          reason: specific.reason,
          statusCode: specific.statusCode,
          model: specific.model,
          message: specific.message,
          cooldownModels,
        };
      }
    }

    if (!normTarget && cooldownModels.length > 0) {
      const top = cooldownModels[0];
      return {
        index: idx,
        label,
        status: 'cooldown',
        cooldownRemainingSec: top.remainingSec,
        reason: top.reason,
        statusCode: top.statusCode,
        model: top.model,
        message: top.message,
        cooldownModels,
      };
    }

    return {
      index: idx,
      label,
      status: 'ready',
      cooldownRemainingSec: 0,
      cooldownModels: cooldownModels.length > 0 ? cooldownModels : undefined,
    };
  });
}

export function getSharedCooldownMap() {
  return memoryFallbackMap;
}

function extractShortGeminiError(rawText, status) {
  let msg = `HTTP ${status}`;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed?.error?.message) msg = String(parsed.error.message);
  } catch {
    if (rawText) msg = String(rawText);
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function probeSingleKey(key, probeModel, sharedMap, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7500);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const modelToUse = String(probeModel || 'gemini-3.8-flash').trim() || 'gemini-3.8-flash';
  const countEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelToUse
  )}:countTokens`;

  try {
    let upstream = await fetch(countEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      }),
      signal: controller.signal,
    });

    if (upstream.status === 404) {
      upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        method: 'GET',
        headers: {
          'x-goog-api-key': key,
        },
        signal: controller.signal,
      });
    }

    if (upstream.ok) {
      const prevState = getKeyCooldownState(key, modelToUse, sharedMap);
      if (
        prevState.isInvalid ||
        prevState.reason === 'overload' ||
        prevState.reason === 'timeout' ||
        prevState.reason === 'network'
      ) {
        await clearKeyCooldown(key, {}, sharedMap);
      }
      return { ok: true };
    }

    const errRaw = await upstream.text().catch(() => '');
    const errMsg = extractShortGeminiError(errRaw, upstream.status);
    const isBadKey =
      upstream.status === 401 ||
      upstream.status === 403 ||
      (upstream.status === 400 &&
        /api.?key|expired|invalid|permission|blocked|suspended/i.test(errMsg));

    if (isBadKey) {
      await recordKeyCooldown(key, 900_000, sharedMap, {
        reason: 'invalid_key',
        statusCode: upstream.status,
        model: modelToUse,
        message: errMsg,
        scope: 'global',
      });
      return { ok: false, status: upstream.status };
    }

    if (upstream.status === 429) {
      const retryAfterSecRaw = Number(upstream.headers.get('retry-after'));
      const coolMs =
        Number.isFinite(retryAfterSecRaw) && retryAfterSecRaw > 0 && retryAfterSecRaw <= 300
          ? retryAfterSecRaw * 1000
          : 60_000;
      await recordKeyCooldown(key, coolMs, sharedMap, {
        reason: 'rate_limit',
        statusCode: 429,
        model: modelToUse,
        message: errMsg,
        scope: 'model',
      });
      return { ok: false, status: 429 };
    }

    if (upstream.status >= 500 || upstream.status === 408) {
      await recordKeyCooldown(key, 15_000, sharedMap, {
        reason: 'overload',
        statusCode: upstream.status,
        model: modelToUse,
        message: errMsg,
        scope: 'global',
      });
      return { ok: false, status: upstream.status };
    }

    return { ok: true };
  } catch (err) {
    if (parentSignal?.aborted) return { ok: false, aborted: true };
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    await recordKeyCooldown(key, 15_000, sharedMap, {
      reason: isTimeout ? 'timeout' : 'network',
      statusCode: isTimeout ? 504 : 502,
      model: modelToUse,
      message: isTimeout ? 'Probe timeout (>7.5s)' : 'Gagal terhubung ke Gemini API',
      scope: 'global',
    });
    return { ok: false };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export async function resolveKeyStatusReport({
  keys = [],
  source = 'none',
  targetModel = '',
  action = 'status',
  keyIndex,
  probeModel,
  signal,
}) {
  const sharedMap = getSharedCooldownMap();
  await hydrateKeyCooldowns(keys, sharedMap);

  if (action === 'clear-cooldown' && keys.length > 0) {
    if (Number.isInteger(keyIndex) && keyIndex >= 0 && keyIndex < keys.length) {
      await clearKeyCooldown(keys[keyIndex], {}, sharedMap);
    } else {
      await clearAllKeyCooldowns(keys, sharedMap);
    }
  } else if (action === 'probe' && keys.length > 0) {
    const modelToProbe = String(probeModel || targetModel || 'gemini-3.8-flash').trim();
    const BATCH_SIZE = 6;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      if (signal?.aborted) break;
      const batch = keys.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((k) => probeSingleKey(k, modelToProbe, sharedMap, signal)));
    }
  }

  const snapshot = getKeyStatusSnapshot(keys, targetModel, sharedMap);
  const summary = {
    total: snapshot.length,
    ready: snapshot.filter((k) => k.status === 'ready').length,
    cooldown: snapshot.filter((k) => k.status === 'cooldown').length,
    invalid: snapshot.filter((k) => k.status === 'invalid').length,
  };

  return {
    ok: true,
    source,
    sharedStore: isSharedCooldownEnabled() ? 'upstash-redis' : 'memory',
    totalKeys: keys.length,
    targetModel: targetModel || '',
    probed: action === 'probe',
    summary,
    keys: snapshot,
  };
}
