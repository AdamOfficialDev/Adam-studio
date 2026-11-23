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

  return Response.json(
    {
      ok: true,
      source: usingBrowserKeys ? 'browser' : envKeys.length > 0 ? 'server' : 'none',
      totalKeys: activeKeys.length,
      keys: activeKeys.map((k, idx) => ({
        label: maskKeyLabel(k, idx),
        status: 'ready',
        cooldownRemainingSec: 0,
      })),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
