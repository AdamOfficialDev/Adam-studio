import { resolveKeyStatusReport } from './_cooldown.js';

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

export default async function handler(request) {
  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body = {};
  if (request.method === 'POST') {
    try {
      const text = await request.text();
      if (text && text.trim()) body = JSON.parse(text);
    } catch {
      body = {};
    }
  }

  const url = new URL(request.url);
  const action = String(body?.action || url.searchParams.get('action') || 'status').trim();
  const targetModel = String(body?.model || url.searchParams.get('model') || '').trim();
  const probeModel = String(body?.probeModel || url.searchParams.get('probeModel') || '').trim();
  const keyIndex =
    typeof body?.keyIndex === 'number' && Number.isInteger(body.keyIndex)
      ? body.keyIndex
      : undefined;

  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const usingBrowserKeys = headerKeys.length > 0;
  const activeKeys = usingBrowserKeys ? headerKeys : envKeys;
  const source = usingBrowserKeys ? 'browser' : envKeys.length > 0 ? 'server' : 'none';

  const report = await resolveKeyStatusReport({
    keys: activeKeys,
    source,
    targetModel,
    action,
    keyIndex,
    probeModel,
    signal: request.signal,
  });

  return Response.json(report, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
