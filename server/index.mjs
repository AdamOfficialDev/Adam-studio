import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const ROTATE_IMMEDIATELY_STATUSES = new Set([401, 403, 429]);

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

// Endpoint resmi hitung token per file ala Google AI Studio
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
  for (const candidate of ordered.slice(0, Math.min(ordered.length, 3))) {
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
      `- Menyiapkan HTML Artifact interaktif agar dapat diuji dengan **Visual Element Inspector**.\n`,
      `- Mendemonstrasikan Time-Machine Diff & Per-File Token Counter.`,
    ].join('');

    const thoughtTokens = demoThought.match(/\S+\s*/g) || [demoThought];
    for (const chunk of thoughtTokens) {
      await sleep(20, signal);
      writeSseEvent(res, 'thought', { text: chunk });
    }
  }

  const demoReply = [
    `Berikut hasil **Adam Studio v5.1 (Demo SSE Mode)** pada model \`${model}\`.\n\n`,
    '```html\n',
    '<!doctype html>\n',
    '<html>\n',
    '<head>\n',
    '  <meta charset="utf-8" />\n',
    '  <style>\n',
    '    * { box-sizing: border-box; }\n',
    '    body { margin: 0; font-family: system-ui, sans-serif; background: #09090b; color: #fafafa; min-height: 100vh; display: grid; place-items: center; padding: 20px; }\n',
    '    .card { width: 100%; max-width: 360px; padding: 24px; border-radius: 20px; background: #18181b; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 20px 50px rgba(0,0,0,0.5); }\n',
    '    h2 { margin: 0 0 8px; font-size: 20px; }\n',
    '    p { margin: 0 0 18px; font-size: 13px; color: #a1a1aa; line-height: 1.5; }\n',
    '    .action-btn { width: 100%; padding: 12px; border-radius: 12px; border: 0; font-weight: 600; cursor: pointer; background: #3b82f6; color: #fff; }\n',
    '  </style>\n',
    '</head>\n',
    '<body>\n',
    '  <div class="card">\n',
    '    <h2>Adam Studio v5.1</h2>\n',
    '    <p>Aktifkan ikon Crosshair untuk Inspect tombol di bawah ini.</p>\n',
    '    <button class="action-btn" id="main-cta">Tombol Utama</button>\n',
    '  </div>\n',
    '</body>\n',
    '</html>\n',
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

function buildGeminiContents(messages) {
  return messages.map((msg) => {
    const parts = [];
    if (msg.content && msg.content.trim().length > 0) {
      parts.push({ text: msg.content });
    }
    if (Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        parts.push(...buildAttachmentParts(att));
      }
    }
    if (parts.length === 0) {
      parts.push({ text: ' ' });
    }
    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });
}

function buildGeminiPayload({
  messages,
  systemInstruction,
  temperature,
  maxOutputTokens,
  includeThoughts,
  thinkingBudget,
  withThinkingConfig,
}) {
  const generationConfig = {
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7,
    maxOutputTokens: Number.isFinite(Number(maxOutputTokens))
      ? Number(maxOutputTokens)
      : 8192,
  };

  if (withThinkingConfig && includeThoughts && Number(thinkingBudget) !== 0) {
    const thinkingConfig = { includeThoughts: true };
    if (Number(thinkingBudget) > 0) {
      thinkingConfig.thinkingBudget = Number(thinkingBudget);
    }
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const payload = {
    contents: buildGeminiContents(messages),
    generationConfig,
  };

  if (typeof systemInstruction === 'string' && systemInstruction.trim().length > 0) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction.trim() }],
    };
  }

  return payload;
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

async function fetchGeminiWithRotationAndRetry({
  targetModel,
  apiKeys,
  messages,
  systemInstruction,
  temperature,
  maxOutputTokens,
  includeThoughts,
  thinkingBudget,
  signal,
  onStatus,
  onInfo,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    targetModel
  )}:streamGenerateContent?alt=sse`;

  let wantsThinking = Boolean(includeThoughts) && Number(thinkingBudget) !== 0;
  const orderedKeys = buildOrderedCandidateKeys(apiKeys);
  const maxAttempts = Math.min(Math.max(orderedKeys.length * 2, 4), 10);

  let keyPointer = 0;
  let lastStatus = 503;
  let lastErrorMessage = 'Semua API Key sedang sibuk atau terkena limit.';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = orderedKeys[keyPointer % orderedKeys.length];
    const keyLabel = maskKeyLabel(current.key, current.idx);

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': current.key,
      },
      body: JSON.stringify(
        buildGeminiPayload({
          messages,
          systemInstruction,
          temperature,
          maxOutputTokens,
          includeThoughts,
          thinkingBudget,
          withThinkingConfig: wantsThinking,
        })
      ),
      signal,
    });

    if (upstream.ok) {
      if (attempt > 0 && orderedKeys.length > 1) {
        onInfo(`Berhasil terhubung menggunakan ${keyLabel}`);
      }
      return { ok: true, response: upstream, usedModel: targetModel };
    }

    const errBody = await upstream.text();
    lastStatus = upstream.status;
    lastErrorMessage = extractGeminiError(errBody, upstream.status);

    if (upstream.status === 400 && wantsThinking && /thinking/i.test(errBody)) {
      wantsThinking = false;
      onInfo(`Model ${targetModel} tidak mendukung thinkingConfig; melanjutkan tanpa thinking summaries.`);
      attempt -= 1;
      continue;
    }

    const isBadKey =
      upstream.status === 401 ||
      upstream.status === 403 ||
      (upstream.status === 400 && /api.?key|expired|invalid/i.test(lastErrorMessage));

    const canRotateToAnotherKey = orderedKeys.length > 1;
    const isRetryable = RETRYABLE_STATUSES.has(upstream.status) || (isBadKey && canRotateToAnotherKey);

    if (isRetryable && attempt + 1 < maxAttempts) {
      const coolMs = isBadKey ? 120_000 : upstream.status === 429 ? 60_000 : 12_000;
      keyCooldownMap.set(current.key, Date.now() + coolMs);

      if (canRotateToAnotherKey) {
        keyPointer += 1;
        const nextCandidate = orderedKeys[keyPointer % orderedKeys.length];
        const nextLabel = maskKeyLabel(nextCandidate.key, nextCandidate.idx);
        const fastRotateDelay = ROTATE_IMMEDIATELY_STATUSES.has(upstream.status) || isBadKey ? 280 : 900;

        onStatus(
          `${keyLabel} terkena (${upstream.status}). Merotasi otomatis ke ${nextLabel} (${attempt + 1}/${maxAttempts})...`
        );
        await sleep(fastRotateDelay, signal);
        continue;
      }

      const retryAfterSec = Number(upstream.headers.get('retry-after'));
      const baseDelay =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 15
          ? retryAfterSec * 1000
          : 1200 * Math.pow(2, attempt) + Math.round(Math.random() * 450);

      onStatus(
        `Server ${targetModel} sedang padat (${upstream.status}). Mencoba ulang otomatis (${attempt + 1}/${maxAttempts - 1}) dalam ${(
          baseDelay / 1000
        ).toFixed(1)}s...`
      );
      await sleep(baseDelay, signal);
      continue;
    }

    return {
      ok: false,
      status: lastStatus,
      message: lastErrorMessage,
    };
  }

  return { ok: false, status: lastStatus, message: lastErrorMessage };
}

app.post('/api/chat', async (req, res) => {
  const {
    model = DEFAULT_MODEL,
    messages = [],
    systemInstruction = '',
    temperature = 0.7,
    maxOutputTokens = 8192,
    includeThoughts = true,
    thinkingBudget = -1,
    autoFallbackOnOverload = false,
    fallbackModel = 'gemini-2.5-pro',
    demoMode = false,
  } = req.body || {};

  const headerKeys = parseKeyPool(
    typeof req.headers['x-gemini-api-keys'] === 'string' ? req.headers['x-gemini-api-keys'] : '',
    typeof req.headers['x-gemini-api-key'] === 'string' ? req.headers['x-gemini-api-key'] : ''
  );
  const serverKeys = getServerEnvKeys();
  const apiKeys = headerKeys.length > 0 ? headerKeys : serverKeys;

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
        includeThoughts: Boolean(includeThoughts) && Number(thinkingBudget) !== 0,
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

    let result = await fetchGeminiWithRotationAndRetry({
      targetModel: model,
      apiKeys,
      messages,
      systemInstruction,
      temperature,
      maxOutputTokens,
      includeThoughts,
      thinkingBudget,
      signal: abortController.signal,
      onStatus: (message) => writeSseEvent(res, 'status', { message }),
      onInfo: (message) => writeSseEvent(res, 'info', { message }),
    });

    if (
      !result.ok &&
      RETRYABLE_STATUSES.has(result.status) &&
      autoFallbackOnOverload &&
      fallbackModel &&
      fallbackModel !== model
    ) {
      writeSseEvent(res, 'status', {
        message: `${model} masih penuh (${result.status}). Beralih otomatis ke ${fallbackModel}...`,
      });
      writeSseEvent(res, 'info', {
        message: `Fallback otomatis ke ${fallbackModel} karena ${model} mengalami high demand.`,
      });
      result = await fetchGeminiWithRotationAndRetry({
        targetModel: fallbackModel,
        apiKeys,
        messages,
        systemInstruction,
        temperature,
        maxOutputTokens,
        includeThoughts,
        thinkingBudget,
        signal: abortController.signal,
        onStatus: (message) => writeSseEvent(res, 'status', { message }),
        onInfo: (message) => writeSseEvent(res, 'info', { message }),
      });
    }

    if (!result.ok) {
      writeSseEvent(res, 'error', {
        status: result.status,
        message: result.message,
      });
      return;
    }

    const upstream = result.response;
    const activeModel = result.usedModel;

    if (!upstream.body) {
      writeSseEvent(res, 'error', {
        status: 502,
        message: 'Stream respons dari Gemini API kosong.',
      });
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastFinishReason = undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundaryIndex;
      while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());

        if (dataLines.length === 0) continue;
        const jsonString = dataLines.join('\n').trim();
        if (!jsonString || jsonString === '[DONE]') continue;

        try {
          const chunk = JSON.parse(jsonString);
          const candidate = chunk?.candidates?.[0];
          const parts = candidate?.content?.parts;

          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part?.thought && typeof part?.text === 'string' && part.text.length > 0) {
                writeSseEvent(res, 'thought', { text: part.text });
              } else if (typeof part?.text === 'string' && part.text.length > 0) {
                writeSseEvent(res, 'delta', { text: part.text });
              }
            }
          }

          if (candidate?.finishReason) lastFinishReason = candidate.finishReason;
          if (chunk?.usageMetadata) writeSseEvent(res, 'usage', chunk.usageMetadata);
        } catch {
          // Abaikan JSON parsial
        }
      }
    }

    writeSseEvent(res, 'done', {
      model: activeModel,
      finishReason: lastFinishReason || 'STOP',
      isDemo: false,
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
  console.log(`⚡ Adam Studio v5.1 SSE Server aktif di http://localhost:${PORT}`);
  console.log(`   Default model: ${DEFAULT_MODEL} | Server API Keys: ${envKeys.length}`);
});
