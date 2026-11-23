import { hydrateKeyCooldowns, recordKeyCooldown } from './_cooldown.js';

export const config = {
  runtime: 'edge',
};

let roundRobinCursor = Math.floor(Math.random() * 1000);
const compactCooldownMap = new Map();

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

function buildOrderedCompactKeys(apiKeys) {
  const now = Date.now();
  const startOffset = roundRobinCursor % apiKeys.length;
  roundRobinCursor = (roundRobinCursor + 1) % apiKeys.length;
  const rotated = [...apiKeys.slice(startOffset), ...apiKeys.slice(0, startOffset)];
  const ready = [];
  const cooling = [];
  for (const key of rotated) {
    if ((compactCooldownMap.get(key) || 0) > now) cooling.push(key);
    else ready.push(key);
  }
  return [...ready, ...cooling];
}

async function callGeminiSummary({ model, apiKeys, prompt, signal }) {
  const candidates = Array.from(
    new Set(['gemini-3.8-flash', model || 'gemini-4-hydrogen'].filter(Boolean))
  );
  await hydrateKeyCooldowns(apiKeys, compactCooldownMap);
  const orderedKeys = buildOrderedCompactKeys(apiKeys);
  const disabledModels = new Set();

  let lastError = 'Gagal meringkas konteks.';

  for (const targetModel of candidates) {
    if (disabledModels.has(targetModel)) continue;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      targetModel
    )}:generateContent`;

    for (const key of orderedKeys) {
      let useMinimalThinking = true;
      let triedNoThinking = false;

      while (true) {
        try {
          const generationConfig = {
            maxOutputTokens: 4096,
          };
          if (useMinimalThinking) {
            generationConfig.thinkingConfig = {
              thinkingLevel: 'MINIMAL',
              includeThoughts: false,
            };
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig,
            }),
            signal,
          });

          if (res.ok) {
            const json = await res.json();
            const text = json?.candidates?.[0]?.content?.parts
              ?.filter((p) => !p?.thought)
              ?.map((p) => p?.text || '')
              .join('')
              .trim();
            if (text) return { ok: true, text };
            lastError = 'Ringkasan kosong dari model.';
          } else {
            const errRaw = await res.text();
            lastError = extractGeminiError(errRaw, res.status);
            if (res.status === 400 && useMinimalThinking && !triedNoThinking && /thinking/i.test(errRaw)) {
              useMinimalThinking = false;
              triedNoThinking = true;
              continue;
            }
            if (res.status === 404) {
              disabledModels.add(targetModel);
              break;
            }
            if (res.status === 429 || res.status === 401 || res.status === 403) {
              await recordKeyCooldown(
                key,
                res.status === 429 ? 60_000 : 120_000,
                compactCooldownMap
              );
            }
          }
        } catch (err) {
          if (signal?.aborted) throw err;
          lastError = err instanceof Error ? err.message : 'Network error';
        }
        break;
      }

      if (disabledModels.has(targetModel)) break;
    }
  }

  return { ok: false, error: lastError };
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

  const { model, chunks = [] } = body || {};
  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const apiKeys = headerKeys.length > 0 ? headerKeys : envKeys;

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return Response.json({ ok: false, message: 'Chunks kosong.' }, { status: 400 });
  }
  if (apiKeys.length === 0) {
    return Response.json({ ok: false, message: 'API Key belum tersedia.' }, { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event, payload) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          // Abaikan
        }
      };

      try {
        controller.enqueue(encoder.encode(': init\n\n'));
        const partSummaries = [];

        for (let i = 0; i < chunks.length; i++) {
          sendEvent('status', {
            message: `Meringkas riwayat bagian ${i + 1}/${chunks.length} tanpa menghilangkan detail teknis...`,
          });

          const prompt = [
            'Kamu adalah sistem Lossless Technical Context Compactor.',
            'Tugasmu merangkum potongan riwayat percakapan berikut agar sesi AI dapat dilanjutkan TANPA KEHILANGAN KONTEKS PENTING.',
            'WAJIB pertahankan secara lengkap:',
            '1. Semua permintaan, aturan UI/UX, preferensi gaya bahasa, tech stack, dan batasan dari User.',
            '2. Semua nama file, path, komponen, variabel, API endpoint, dan keputusan arsitektur.',
            '3. Semua bug yang ditemukan, penyebabnya, serta status perbaikannya (sudah fix / belum).',
            '4. Jangan sertakan kode panjang ulang—cukup ringkas fungsi & kontrak perubahannya.',
            '',
            `--- MULAI BAGIAN ${i + 1}/${chunks.length} ---`,
            chunks[i],
            `--- AKHIR BAGIAN ${i + 1}/${chunks.length} ---`,
          ].join('\n');

          const res = await callGeminiSummary({
            model,
            apiKeys,
            prompt,
            signal: request.signal,
          });

          if (!res.ok) {
            sendEvent('error', { message: res.error || 'Gagal meringkas bagian chat.' });
            return;
          }
          partSummaries.push(`### Ringkasan Bagian ${i + 1}\n${res.text}`);
        }

        const combined = partSummaries.join('\n\n');
        sendEvent('result', { ok: true, summary: combined });
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
