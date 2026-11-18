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
const MAX_RETRIES = 3;

app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    defaultModel: DEFAULT_MODEL,
    hasServerApiKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
    demoModeEnv: process.env.DEMO_MODE === 'true',
  });
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
      `Pengguna meminta: "${userText.slice(0, 100)}". Saya perlu menyusun jawaban yang terstruktur dan langsung dapat dieksekusi.\n\n`,
      `**2. Merencanakan Struktur Respons (${model})**\n`,
      `- Menyiapkan diagram arsitektur Mermaid.\n`,
      `- Menyertakan formula estimasi token menggunakan LaTeX.\n`,
      `- Membuat komponen Artifact HTML mandiri yang aman di sandbox preview.`,
    ].join('');

    const thoughtTokens = demoThought.match(/\S+\s*/g) || [demoThought];
    for (const chunk of thoughtTokens) {
      await sleep(24, signal);
      writeSseEvent(res, 'thought', { text: chunk });
    }
  }

  const demoReply = [
    `Berikut hasil dari **Real-Time SSE Adam Studio** pada model \`${model}\`.\n\n`,
    `> **Prompt diterima:** ${userText.replace(/\n/g, ' ')}\n\n`,
    `### 1. Alur Arsitektur SSE & Resilience\n`,
    '```mermaid\n',
    'flowchart LR\n',
    '  A[User Composer] -->|includeThoughts: true| B[SSE Proxy + Retry 3x]\n',
    '  B -->|streamGenerateContent?alt=sse| C[(Gemini API)]\n',
    '  C -->|part.thought| D[Live Thinking Card]\n',
    '  C -->|part.text| E[Answer + Artifact Canvas]\n',
    '```\n\n',
    `### 2. Rumus Estimasi Biaya Token\n`,
    `$$\n\\text{Cost} = \\frac{T_{\\text{in}}}{10^6} \\times 1.50 + \\frac{T_{\\text{out}}}{10^6} \\times 7.50\n$$\n`,
  ].join('');

  const tokens = demoReply.match(/\S+\s*/g) || [demoReply];
  for (const token of tokens) {
    await sleep(16, signal);
    writeSseEvent(res, 'delta', { text: token });
  }

  const promptTokens = Math.max(32, Math.ceil(userText.length / 3));
  writeSseEvent(res, 'usage', {
    promptTokenCount: promptTokens,
    candidatesTokenCount: tokens.length,
    thoughtsTokenCount: includeThoughts ? 56 : 0,
    totalTokenCount: promptTokens + tokens.length + (includeThoughts ? 56 : 0),
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
        if (att?.kind === 'text' && typeof att?.textContent === 'string') {
          parts.push({
            text: `\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``,
          });
        } else if (att?.mimeType && att?.data) {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data,
            },
          });
        }
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

async function fetchGeminiWithRetry({
  targetModel,
  apiKey,
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

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
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
      return { ok: true, response: upstream, usedModel: targetModel };
    }

    const errBody = await upstream.text();

    // Fallback jika model menolak parameter thinkingConfig
    if (upstream.status === 400 && wantsThinking && /thinking/i.test(errBody)) {
      wantsThinking = false;
      onInfo(`Model ${targetModel} tidak mendukung thinkingConfig; melanjutkan tanpa thinking summaries.`);
      attempt -= 1;
      continue;
    }

    if (RETRYABLE_STATUSES.has(upstream.status) && attempt < MAX_RETRIES) {
      const retryAfterSec = Number(upstream.headers.get('retry-after'));
      const baseDelay =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 15
          ? retryAfterSec * 1000
          : 1200 * Math.pow(2, attempt) + Math.round(Math.random() * 450);

      onStatus(
        `Server ${targetModel} sedang padat (${upstream.status}). Mencoba ulang otomatis (${attempt + 1}/${MAX_RETRIES}) dalam ${(
          baseDelay / 1000
        ).toFixed(1)}s...`
      );
      await sleep(baseDelay, signal);
      continue;
    }

    return {
      ok: false,
      status: upstream.status,
      message: extractGeminiError(errBody, upstream.status),
    };
  }

  return { ok: false, status: 503, message: 'Server Gemini sedang sibuk.' };
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

  const headerKey =
    typeof req.headers['x-gemini-api-key'] === 'string'
      ? req.headers['x-gemini-api-key'].trim()
      : '';
  const apiKey = headerKey || process.env.GEMINI_API_KEY?.trim() || '';
  const useDemo = Boolean(demoMode) || (process.env.DEMO_MODE === 'true' && !apiKey);

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

    if (!apiKey) {
      writeSseEvent(res, 'error', {
        status: 401,
        message:
          'GEMINI_API_KEY belum diatur. Isi pada .env, masukkan lewat Settings, atau aktifkan Demo SSE Mode.',
      });
      return;
    }

    let result = await fetchGeminiWithRetry({
      targetModel: model,
      apiKey,
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
      result = await fetchGeminiWithRetry({
        targetModel: fallbackModel,
        apiKey,
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
  console.log(`⚡ Adam Studio SSE Server aktif di http://localhost:${PORT}`);
  console.log(`   Default model: ${DEFAULT_MODEL}`);
});
