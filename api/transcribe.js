export const config = {
  runtime: 'edge',
};

let roundRobinCursor = Math.floor(Math.random() * 1000);
const keyCooldownMap = new Map();

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

function buildOrderedKeys(keys) {
  const now = Date.now();
  const start = roundRobinCursor % keys.length;
  roundRobinCursor = (roundRobinCursor + 1) % keys.length;

  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const ready = [];
  const cooling = [];
  for (const k of rotated) {
    if ((keyCooldownMap.get(k) || 0) > now) cooling.push(k);
    else ready.push(k);
  }
  return [...ready, ...cooling];
}

function extractGeminiError(rawText, status) {
  let msg = `Gemini API error (${status})`;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed?.error?.message) msg = parsed.error.message;
  } catch {
    if (rawText) msg = rawText;
  }
  return msg;
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Invalid JSON' }, { status: 400 });
  }

  const { model, mimeType = 'audio/wav', data = '' } = body || {};

  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const apiKeys = headerKeys.length > 0 ? headerKeys : envKeys;

  if (!data) {
    return Response.json({ ok: false, message: 'Data audio kosong.' }, { status: 400 });
  }

  if (apiKeys.length === 0) {
    return Response.json(
      { ok: false, message: 'API Key belum tersedia untuk transkripsi AI Audio.' },
      { status: 401 }
    );
  }

  const defaultModel = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';
  const sttModels = Array.from(
    new Set(['gemini-2.5-flash', model || defaultModel, 'gemini-2.0-flash'].filter(Boolean))
  );
  const cleanMime = String(mimeType).split(';')[0].trim() || 'audio/wav';
  const promptText = [
    'Transcribe the spoken audio accurately verbatim.',
    'The speaker speaks Indonesian mixed with English technical, UI/UX, and software engineering terms',
    '(such as UI/UX, React, Vite, shadcn, TypeScript, JavaScript, pnpm, npm, API, SSE, JSON, HTML, CSS, SQL, PWA, Vercel, GitHub, Gemini 4 Hydrogen).',
    'Output ONLY the transcribed text with natural punctuation and proper technical capitalization. Do not answer the prompt or add commentary.',
  ].join(' ');

  const orderedKeys = buildOrderedKeys(apiKeys);
  let lastStatus = 502;
  let lastError = 'Transkripsi AI Audio gagal.';

  for (const sttModel of sttModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      sttModel
    )}:generateContent`;

    for (const key of orderedKeys) {
      try {
        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: promptText },
                  { inlineData: { mimeType: cleanMime, data } },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          }),
        });

        if (upstream.ok) {
          const json = await upstream.json();
          const textOut = json?.candidates?.[0]?.content?.parts
            ?.map((p) => p?.text || '')
            .join('')
            .trim();
          if (textOut) {
            return Response.json({ ok: true, text: textOut });
          }
          lastError = 'Suara tidak terdeteksi / hasil transkrip kosong.';
        } else {
          lastStatus = upstream.status;
          const errRaw = await upstream.text();
          lastError = extractGeminiError(errRaw, upstream.status);
          if (upstream.status === 429 || upstream.status === 401 || upstream.status === 403) {
            keyCooldownMap.set(key, Date.now() + 60_000);
          }
          if (upstream.status === 404) break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Network error';
      }
    }
  }

  return Response.json(
    { ok: false, message: lastError },
    { status: lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502 }
  );
}
