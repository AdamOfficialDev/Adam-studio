import { hydrateKeyCooldowns, isSharedCooldownEnabled } from './_cooldown.js';

export const config = {
  runtime: 'edge',
};

function parseKeyPool(...sources) {
  const pool = [];
  const seen = new Set();
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue;
    for (const part of src.split(/[\r\n,;]+/)) {
      const k = part.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        pool.push(k);
      }
    }
  }
  return pool;
}

function maskKeyLabel(key, idx) {
  const tail = key.length >= 4 ? key.slice(-4) : '****';
  return `Key #${idx + 1} (•••${tail})`;
}

export default async function handler(request) {
  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const usingBrowserKeys = headerKeys.length > 0;
  const activeKeys = usingBrowserKeys ? headerKeys : envKeys;

  const tempMap = new Map();
  await hydrateKeyCooldowns(activeKeys, tempMap);
  const now = Date.now();

  return Response.json(
    {
      ok: true,
      source: usingBrowserKeys ? 'browser' : envKeys.length > 0 ? 'server' : 'none',
      sharedStore: isSharedCooldownEnabled() ? 'upstash-redis' : 'memory',
      totalKeys: activeKeys.length,
      keys: activeKeys.map((k, idx) => {
        const coolUntil = tempMap.get(k) || 0;
        const cooldownRemainingSec = coolUntil > now ? Math.ceil((coolUntil - now) / 1000) : 0;
        return {
          label: maskKeyLabel(k, idx),
          status: cooldownRemainingSec > 0 ? 'cooldown' : 'ready',
          cooldownRemainingSec,
        };
      }),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
