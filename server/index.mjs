import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { handleGitHubAction } from '../api/_github.js';
import { getKeyPoolStatusAsync, runResilientGeminiChat } from '../api/_gemini.js';
import {
  hydrateKeyCooldowns,
  isSharedCooldownEnabled,
  recordKeyCooldown,
} from '../api/_cooldown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';

let roundRobinCursor = 0;
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

function getServerEnvKeys() {
  return parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
}

function maskKeyLabel(key, idx) {
  const tail = key.length >= 4 ? key.slice(-4) : '****';
  return `Key #${idx + 1} (•••${tail})`;
}

app.use(express.json({ limit: '50mb' }));

app.post('/api/github', async (req, res) => {
  const token =
    (typeof req.headers['x-github-token'] === 'string' ? req.headers['x-github-token'].trim() : '') ||
    process.env.GITHUB_TOKEN?.trim() ||
    '';
  try {
    const result = await handleGitHubAction({ action: req.body?.action, body: req.body, token });
    res.status(result.status).json(result.payload);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'GitHub error' });
  }
});

app.get('/api/health', (_req, res) => {
  const envKeys = getServerEnvKeys();
  res.json({
    ok: true,
    defaultModel: DEFAULT_MODEL,
    hasServerApiKey: envKeys.length > 0,
    serverKeyCount: envKeys.length,
    demoModeEnv: process.env.DEMO_MODE === 'true',
  });
});

app.post('/api/key-status', async (req, res) => {
  const headerKeys = parseKeyPool(
    typeof req.headers['x-gemini-api-keys'] === 'string' ? req.headers['x-gemini-api-keys'] : '',
    typeof req.headers['x-gemini-api-key'] === 'string' ? req.headers['x-gemini-api-key'] : ''
  );
  const envKeys = getServerEnvKeys();
  const usingBrowserKeys = headerKeys.length > 0;
  const activeKeys = usingBrowserKeys ? headerKeys : envKeys;
  const now = Date.now();

  await hydrateKeyCooldowns(activeKeys, keyCooldownMap);
  const geminiStatuses = await getKeyPoolStatusAsync(activeKeys);
  const merged = geminiStatuses.map((item, idx) => {
    const rawKey = activeKeys[idx];
    const localCool = keyCooldownMap.get(rawKey) || 0;
    const localRemaining = localCool > now ? Math.ceil((localCool - now) / 1000) : 0;
    const remaining = Math.max(item.cooldownRemainingSec || 0, localRemaining);
    return {
      label: item.label,
      status: remaining > 0 ? 'cooldown' : 'ready',
      cooldownRemainingSec: remaining,
    };
  });

  res.json({
    ok: true,
    source: usingBrowserKeys ? 'browser' : envKeys.length > 0 ? 'server' : 'none',
    sharedStore: isSharedCooldownEnabled() ? 'upstash-redis' : 'memory',
    totalKeys: activeKeys.length,
    keys: merged,
  });
});

function buildAttachmentParts(att) {
  if (!att) return [];
  if (att.kind === 'text' && typeof att.textContent === 'string') {
    return [
      {
        text: `\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``,
      },
    ];
  }
  if (att.mimeType && att.data) {
    return [
      {
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      },
    ];
  }
  if (att.name) {
    return [{ text: `[Attached ${att.kind || 'file'}: ${att.name}]` }];
  }
  return [];
}

app.post('/api/count-tokens', async (req, res) => {
  const { model = DEFAULT_MODEL, attachment } = req.body || {};

  const headerKeys = parseKeyPool(
    typeof req.headers['x-gemini-api-keys'] === 'string' ? req.headers['x-gemini-api-keys'] : '',
    typeof req.headers['x-gemini-api-key'] === 'string' ? req.headers['x-gemini-api-key'] : ''
  );
  const apiKeys = headerKeys.length > 0 ? headerKeys : getServerEnvKeys();

  if (!attachment || apiKeys.length === 0) {
    res.status(400).json({ ok: false });
    return;
  }

  const parts = buildAttachmentParts(attachment);
  if (parts.length === 0) {
    res.status(400).json({ ok: false });
    return;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:countTokens`;

  const ordered = buildOrderedCandidateKeys(apiKeys);
  for (const candidate of ordered) {
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': candidate.key,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
        }),
      });
      if (upstream.ok) {
        const json = await upstream.json();
        if (typeof json?.totalTokens === 'number') {
          res.json({ ok: true, totalTokens: json.totalTokens });
          return;
        }
      }
    } catch {
      // Coba key berikutnya
    }
  }

  res.status(502).json({ ok: false });
});

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

app.post('/api/compact', async (req, res) => {
  const { model, chunks = [] } = req.body || {};

  const headerKeys = parseKeyPool(
    typeof req.headers['x-gemini-api-keys'] === 'string' ? req.headers['x-gemini-api-keys'] : '',
    typeof req.headers['x-gemini-api-key'] === 'string' ? req.headers['x-gemini-api-key'] : ''
  );
  const apiKeys = headerKeys.length > 0 ? headerKeys : getServerEnvKeys();

  if (!Array.isArray(chunks) || chunks.length === 0) {
    res.status(400).json({ ok: false, message: 'Chunks kosong.' });
    return;
  }
  if (apiKeys.length === 0) {
    res.status(401).json({ ok: false, message: 'API Key belum tersedia.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  const candidates = Array.from(
    new Set(['gemini-3.8-flash', model || DEFAULT_MODEL].filter(Boolean))
  );
  const disabledModels = new Set();

  try {
    const partSummaries = [];

    for (let i = 0; i < chunks.length; i++) {
      await hydrateKeyCooldowns(apiKeys, keyCooldownMap);
      const ordered = buildOrderedCandidateKeys(apiKeys);
      writeSseEvent(res, 'status', {
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

      let chunkDone = false;
      let lastErr = 'Gagal meringkas bagian chat.';

      for (const targetModel of candidates) {
        if (chunkDone || disabledModels.has(targetModel)) continue;
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          targetModel
        )}:generateContent`;

        for (const entry of ordered) {
          let useMinimalThinking = true;
          let triedNoThinking = false;

          while (true) {
            try {
              const generationConfig = { maxOutputTokens: 4096 };
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
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig,
                  }),
                },
                abortController.signal,
                25000
              );

              if (upstream.ok) {
                const json = await upstream.json();
                const text = json?.candidates?.[0]?.content?.parts
                  ?.filter((p) => !p?.thought)
                  ?.map((p) => p?.text || '')
                  .join('')
                  .trim();
                if (text) {
                  partSummaries.push(`### Ringkasan Bagian ${i + 1}\n${text}`);
                  chunkDone = true;
                  break;
                }
              } else {
                const errRaw = await upstream.text();
                lastErr = extractGeminiError(errRaw, upstream.status);
                if (
                  upstream.status === 400 &&
                  useMinimalThinking &&
                  !triedNoThinking &&
                  /thinking/i.test(errRaw)
                ) {
                  useMinimalThinking = false;
                  triedNoThinking = true;
                  continue;
                }
                if (upstream.status === 404) {
                  disabledModels.add(targetModel);
                  break;
                }
                if (upstream.status === 429 || upstream.status === 401 || upstream.status === 403) {
                  await recordKeyCooldown(
                    entry.key,
                    upstream.status === 429 ? 60_000 : 120_000,
                    keyCooldownMap
                  );
                }
              }
            } catch (err) {
              if (abortController.signal.aborted) return;
              lastErr = err instanceof Error ? err.message : 'Network error';
            }
            break;
          }
          if (chunkDone) break;
        }
      }

      if (!chunkDone) {
        writeSseEvent(res, 'error', { message: lastErr });
        return;
      }
    }

    writeSseEvent(res, 'result', { ok: true, summary: partSummaries.join('\n\n') });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

app.post('/api/transcribe', async (req, res) => {
  const { model, mimeType = 'audio/wav', data = '' } = req.body || {};

  const headerKeys = parseKeyPool(
    typeof req.headers['x-gemini-api-keys'] === 'string' ? req.headers['x-gemini-api-keys'] : '',
    typeof req.headers['x-gemini-api-key'] === 'string' ? req.headers['x-gemini-api-key'] : ''
  );
  const apiKeys = headerKeys.length > 0 ? headerKeys : getServerEnvKeys();

  if (!data) {
    res.status(400).json({ ok: false, message: 'Data audio kosong.' });
    return;
  }

  if (apiKeys.length === 0) {
    res.status(401).json({
      ok: false,
      message: 'API Key belum tersedia untuk transkripsi AI Audio.',
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  const sttModels = Array.from(
    new Set(['gemini-3.8-flash', model || DEFAULT_MODEL].filter(Boolean))
  );
  const orderedKeys = buildOrderedCandidateKeys(apiKeys);
  const cleanMime = String(mimeType).split(';')[0].trim() || 'audio/wav';

  const promptText = [
    'Transcribe the spoken audio accurately verbatim.',
    'The speaker speaks Indonesian mixed with English technical, UI/UX, and software engineering terms',
    '(such as UI/UX, React, Vite, shadcn, TypeScript, JavaScript, pnpm, npm, API, SSE, JSON, HTML, CSS, SQL, PWA, Vercel, GitHub, Gemini 4 Hydrogen).',
    'Output ONLY the transcribed text with natural punctuation and proper technical capitalization. Do not answer the prompt or add commentary.',
  ].join(' ');

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
  let lastError = 'Transkripsi AI Audio gagal.';

  try {
    for (const { sttModel, entry } of attempts) {
      if (abortController.signal.aborted) return;
      if (disabledModels.has(sttModel)) continue;

      const label = maskKeyLabel(entry.key, entry.idx);
      writeSseEvent(res, 'status', {
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
            abortController.signal,
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
              writeSseEvent(res, 'result', { ok: true, text: textOut, model: sttModel });
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
            await recordKeyCooldown(entry.key, 60_000, keyCooldownMap);
          }
          break;
        } catch (err) {
          if (abortController.signal.aborted) return;
          lastError =
            err instanceof Error && err.name === 'AbortError'
              ? `Timeout ${sttModel} (${label})`
              : err instanceof Error
                ? err.message
                : 'Network error';
          break;
        }
      }
    }

    writeSseEvent(res, 'error', { ok: false, message: lastError });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

function writeSseEvent(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function runDemoSse({ res, model, messages, includeThoughts = true, signal }) {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const userText = lastUserMsg?.content?.trim() || 'Showcase Studio';

  if (includeThoughts) {
    const demoThought = [
      `**1. Memahami Intent Prompt**\n`,
      `Pengguna meminta: "${userText.slice(0, 100)}".\n\n`,
      `**2. Merencanakan Struktur Respons (${model})**\n`,
      `- Menyiapkan HTML Artifact interaktif agar dapat diuji dengan **Visual Element Inspector**.`,
    ].join('');

    const thoughtTokens = demoThought.match(/\S+\s*/g) || [demoThought];
    for (const chunk of thoughtTokens) {
      await sleep(20, signal);
      writeSseEvent(res, 'thought', { text: chunk });
    }
  }

  const demoReply = [
    `Berikut hasil **Adam Studio (Demo SSE Mode)** pada model \`${model}\`.\n\n`,
    '```html\n',
    '<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#09090b;color:#fff;font-family:sans-serif">',
    '<div style="padding:24px;border-radius:16px;border:1px solid #27272a;background:#18181b;text-align:center">',
    '<h3>Adam Studio v6.1</h3><button style="margin-top:12px;padding:10px 16px;border-radius:10px;border:0;background:#3b82f6;color:#fff;font-weight:600">Inspect Tombol Ini</button>',
    '</div></body></html>\n',
    '```\n',
  ].join('');

  const tokens = demoReply.match(/\S+\s*/g) || [demoReply];
  for (const token of tokens) {
    await sleep(14, signal);
    writeSseEvent(res, 'delta', { text: token });
  }

  const promptTokens = Math.max(32, Math.ceil(userText.length / 3));
  writeSseEvent(res, 'usage', {
    promptTokenCount: promptTokens,
    candidatesTokenCount: tokens.length,
    thoughtsTokenCount: includeThoughts ? 48 : 0,
    totalTokenCount: promptTokens + tokens.length + (includeThoughts ? 48 : 0),
  });
  writeSseEvent(res, 'done', { model, finishReason: 'STOP', isDemo: true });
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

function buildOrderedCandidateKeys(keys) {
  const now = Date.now();
  const start = roundRobinCursor % keys.length;
  roundRobinCursor = (roundRobinCursor + 1) % keys.length;

  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const ready = [];
  const cooling = [];
  for (const item of rotated) {
    const origIdx = keys.indexOf(item);
    const coolUntil = keyCooldownMap.get(item) || 0;
    if (coolUntil > now) {
      cooling.push({ key: item, idx: origIdx });
    } else {
      ready.push({ key: item, idx: origIdx });
    }
  }
  return [...ready, ...cooling];
}

app.post('/api/chat', async (req, res) => {
  const {
    model = DEFAULT_MODEL,
    messages = [],
    githubProject,
    systemInstruction = '',
    maxOutputTokens = 8192,
    includeThoughts = true,
    thinkingLevel = 'medium',
    autoFallbackOnOverload = false,
    fallbackModel = 'gemini-3.8-flash',
    demoMode = false,
    enableGoogleSearch = false,
    enableUrlContext = true,
    continueFrom,
  } = req.body || {};

  const headerKeys = parseKeyPool(
    typeof req.headers['x-gemini-api-keys'] === 'string' ? req.headers['x-gemini-api-keys'] : '',
    typeof req.headers['x-gemini-api-key'] === 'string' ? req.headers['x-gemini-api-key'] : ''
  );
  const serverKeys = getServerEnvKeys();
  const apiKeys = headerKeys.length > 0 ? headerKeys : serverKeys;
  const githubToken =
    (typeof req.headers['x-github-token'] === 'string' ? req.headers['x-github-token'].trim() : '') ||
    process.env.GITHUB_TOKEN?.trim() ||
    '';

  const useDemo = Boolean(demoMode) || (process.env.DEMO_MODE === 'true' && apiKeys.length === 0);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n');
    }
  }, 15000);

  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      writeSseEvent(res, 'error', { status: 400, message: 'Pesan tidak boleh kosong.' });
      return;
    }

    if (useDemo) {
      await runDemoSse({
        res,
        model,
        messages,
        includeThoughts: Boolean(includeThoughts) && String(thinkingLevel || '').toLowerCase() !== 'off',
        signal: abortController.signal,
      });
      return;
    }

    if (apiKeys.length === 0) {
      writeSseEvent(res, 'error', {
        status: 401,
        message:
          'Belum ada GEMINI_API_KEY. Isi 1 atau banyak API Key di Settings → Koneksi (atau .env), atau aktifkan Demo SSE Mode.',
      });
      return;
    }

    await runResilientGeminiChat({
      model,
      apiKeys,
      messages,
      githubProject,
      githubToken,
      systemInstruction,
      maxOutputTokens,
      includeThoughts,
      thinkingLevel,
      autoFallbackOnOverload,
      fallbackModel,
      enableGoogleSearch,
      enableUrlContext,
      continueFrom,
      signal: abortController.signal,
      sendEvent: (event, data) => writeSseEvent(res, event, data),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    writeSseEvent(res, 'error', {
      status: 500,
      message: err instanceof Error ? err.message : 'Terjadi kesalahan internal server.',
    });
  } finally {
    clearInterval(keepAlive);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
}

app.listen(PORT, () => {
  const envKeys = getServerEnvKeys();
  console.log(`⚡ Adam Studio v6.1 SSE Server aktif di http://localhost:${PORT}`);
  console.log(`   Default model: ${DEFAULT_MODEL} | Server API Keys: ${envKeys.length}`);
});
