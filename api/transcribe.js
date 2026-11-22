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
  for (let i = 0; i < rotated.length; i++) {
    const k = rotated[i];
    const origIdx = keys.indexOf(k);
    if ((keyCooldownMap.get(k) || 0) > now) cooling.push({ key: k, idx: origIdx });
    else ready.push({ key: k, idx: origIdx });
  }
  return [...ready, ...cooling];
}

function maskKeyLabel(key, idx) {
  const tail = key.length >= 4 ? key.slice(-4) : '****';
  return `Key #${idx + 1} (•••${tail})`;
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

async function fetchWithTimeout(url, options, parentSignal, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
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
    new Set(['gemini-3.8-flash', model || defaultModel].filter(Boolean))
  );
  const cleanMime = String(mimeType).split(';')[0].trim() || 'audio/wav';
  const promptText = [
    'Transcribe the spoken audio accurately verbatim.',
    'The speaker speaks Indonesian mixed with English technical, UI/UX, and software engineering terms',
    '(such as UI/UX, React, Vite, shadcn, TypeScript, JavaScript, pnpm, npm, API, SSE, JSON, HTML, CSS, SQL, PWA, Vercel, GitHub, Gemini 4 Hydrogen).',
    'Output ONLY the transcribed text with natural punctuation and proper technical capitalization. Do not answer the prompt or add commentary.',
  ].join(' ');

  const orderedKeys = buildOrderedKeys(apiKeys);
  const encoder = new TextEncoder();

  // Kembalikan stream segera (0ms) agar Vercel Edge tidak terkena batas 25s initial response timeout
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event, payload) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          // Stream ditutup
        }
      };

      // Kirim byte awal segera
      try {
        controller.enqueue(encoder.encode(': init\n\n'));
      } catch {
        return;
      }

      let lastError = 'Transkripsi AI Audio gagal.';
      let attemptCount = 0;

      // Susun antrean: uji 3 key pertama per model dulu sebelum habiskan sisa key
      const primaryQueue = [];
      const overflowQueue = [];
      for (const sttModel of sttModels) {
        orderedKeys.forEach((entry, idx) => {
          if (idx < 3) primaryQueue.push({ sttModel, entry });
          else overflowQueue.push({ sttModel, entry });
        });
      }
      const attempts = [...primaryQueue, ...overflowQueue];
      const disabledModels = new Set();

      try {
        for (const { sttModel, entry } of attempts) {
          if (request.signal.aborted) return;
          if (disabledModels.has(sttModel)) continue;

          attemptCount += 1;
          const label = maskKeyLabel(entry.key, entry.idx);
          sendEvent('status', {
            message: `Mentranskrip via ${sttModel} (${label})...`,
          });

          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            sttModel
          )}:generateContent`;

          let useMinimalThinking = true;
          let triedWithoutThinking = false;

          while (true) {
            try {
              const generationConfig = {
                maxOutputTokens: 1024,
              };
              if (useMinimalThinking) {
                generationConfig.thinkingConfig = {
                  thinkingLevel: 'MINIMAL',
                  includeThoughts: false,
                };
              }

              const upstream = await fetchWithTimeout(
                endpoint,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': entry.key,
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
                    generationConfig,
                  }),
                },
                request.signal,
                10000
              );

              if (upstream.ok) {
                const json = await upstream.json();
                const textOut = json?.candidates?.[0]?.content?.parts
                  ?.filter((p) => !p?.thought)
                  ?.map((p) => p?.text || '')
                  .join('')
                  .trim();
                if (textOut) {
                  sendEvent('result', { ok: true, text: textOut, model: sttModel });
                  return;
                }
                lastError = 'Suara tidak terdeteksi / hasil transkrip kosong.';
                break;
              }

              const errRaw = await upstream.text();
              lastError = extractGeminiError(errRaw, upstream.status);

              if (
                upstream.status === 400 &&
                useMinimalThinking &&
                !triedWithoutThinking &&
                /thinking/i.test(errRaw)
              ) {
                useMinimalThinking = false;
                triedWithoutThinking = true;
                continue;
              }

              if (upstream.status === 404) {
                disabledModels.add(sttModel);
                break;
              }

              if (upstream.status === 429 || upstream.status === 401 || upstream.status === 403) {
                keyCooldownMap.set(entry.key, Date.now() + 60_000);
              }
              break;
            } catch (err) {
              if (request.signal.aborted) return;
              lastError =
                err instanceof Error && err.name === 'AbortError'
                  ? `Timeout ${sttModel} (${label})`
                  : err instanceof Error
                    ? err.message
                    : 'Network error';
              break;
            }
          }

          if (attemptCount >= orderedKeys.length * sttModels.length) break;
        }

        sendEvent('error', { ok: false, message: lastError });
      } finally {
        try {
          controller.close();
        } catch {
          // Abaikan
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
