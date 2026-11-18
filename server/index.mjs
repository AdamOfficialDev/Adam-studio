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

async function runDemoSse({ res, model, messages, signal }) {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const userText = lastUserMsg?.content?.trim() || 'Showcase Studio';

  const thoughtChunks = [
    `Menginisialisasi konteks Adam Studio pada profil ${model}... `,
    'Menyusun arsitektur respons: ringkasan teknis, diagram Mermaid, formula KaTeX, serta HTML Artifact interaktif.',
  ];

  for (const t of thoughtChunks) {
    await sleep(130, signal);
    writeSseEvent(res, 'thought', { text: t });
  }

  const demoReply = [
    `Berikut simulasi **Real-Time SSE Adam Studio** pada model \`${model}\`.\n\n`,
    `> **Prompt diterima:** ${userText.replace(/\n/g, ' ')}\n\n`,
    `### 1. Alur Arsitektur SSE & Canvas\n`,
    '```mermaid\n',
    'flowchart LR\n',
    '  A[User Composer] -->|POST + Attachments| B[SSE Proxy]\n',
    '  B -->|streamGenerateContent?alt=sse| C[(Gemini 4 Hydrogen)]\n',
    '  C -->|Token Deltas| B\n',
    '  B -->|60fps Stream| D[Markdown + Mermaid + KaTeX]\n',
    '  D -->|Auto Extract| E[Artifact IDE Canvas]\n',
    '```\n\n',
    `### 2. Rumus Estimasi Biaya Token\n`,
    `$$\n\\text{Cost} = \\frac{T_{\\text{in}}}{10^6} \\times 1.50 + \\frac{T_{\\text{out}}}{10^6} \\times 7.50\n$$\n\n`,
    `### 3. Live Interactive Artifact\n`,
    '```html\n',
    '<!doctype html>\n',
    '<html>\n',
    '<head>\n',
    '  <meta charset="utf-8" />\n',
    '  <style>\n',
    '    * { box-sizing: border-box; }\n',
    '    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #fafafa; min-height: 100vh; display: grid; place-items: center; padding: 20px; }\n',
    '    .panel { width: 100%; max-width: 380px; border-radius: 20px; padding: 24px; background: #18181b; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 25px 60px rgba(0,0,0,0.6); }\n',
    '    .tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; background: rgba(59,130,246,0.16); color: #93c5fd; border: 1px solid rgba(59,130,246,0.3); }\n',
    '    .dot { width: 6px; height: 6px; border-radius: 50%; background: #34d399; }\n',
    '    h2 { margin: 14px 0 6px; font-size: 20px; letter-spacing: -0.02em; }\n',
    '    p { margin: 0 0 18px; font-size: 13px; color: #a1a1aa; line-height: 1.5; }\n',
    '    .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }\n',
    '    .stat { padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); }\n',
    '    .stat label { display: block; font-size: 10px; text-transform: uppercase; color: #71717a; }\n',
    '    .stat strong { font-size: 18px; color: #f4f4f5; }\n',
    '    button { width: 100%; padding: 11px; border-radius: 12px; border: 0; font-weight: 600; font-size: 13px; cursor: pointer; background: #3b82f6; color: white; transition: transform .15s, opacity .15s; }\n',
    '    button:hover { opacity: 0.92; }\n',
    '    button:active { transform: scale(0.98); }\n',
    '  </style>\n',
    '</head>\n',
    '<body>\n',
    '  <div class="panel">\n',
    `    <span class="tag"><span class="dot"></span>${model}</span>\n`,
    '    <h2>Adam Studio Widget</h2>\n',
    '    <p>Edit kode HTML ini di tab <b>IDE Editor</b> untuk melihat Live Preview berubah seketika.</p>\n',
    '    <div class="metrics">\n',
    '      <div class="stat"><label>FPS Stream</label><strong id="fps">60 fps</strong></div>\n',
    '      <div class="stat"><label>Interaksi</label><strong id="clicks">0x</strong></div>\n',
    '    </div>\n',
    '    <button id="boost">Simulasikan Boost Token</button>\n',
    '  </div>\n',
    '  <script>\n',
    '    let count = 0;\n',
    '    const btn = document.getElementById("boost");\n',
    '    const clicks = document.getElementById("clicks");\n',
    '    btn.addEventListener("click", () => {\n',
    '      count += 1;\n',
    '      clicks.textContent = count + "x";\n',
    '    });\n',
    '  </script>\n',
    '</body>\n',
    '</html>\n',
    '```\n',
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
    totalTokenCount: promptTokens + tokens.length,
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

app.post('/api/chat', async (req, res) => {
  const {
    model = DEFAULT_MODEL,
    messages = [],
    systemInstruction = '',
    temperature = 0.7,
    maxOutputTokens = 8192,
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
      writeSseEvent(res, 'error', {
        status: 400,
        message: 'Pesan tidak boleh kosong.',
      });
      return;
    }

    if (useDemo) {
      await runDemoSse({
        res,
        model,
        messages,
        signal: abortController.signal,
      });
      return;
    }

    if (!apiKey) {
      writeSseEvent(res, 'error', {
        status: 401,
        message:
          'GEMINI_API_KEY belum diatur. Isi pada .env, masukkan lewat Settings, atau aktifkan Demo SSE Mode untuk mencoba seluruh fitur Adam Studio.',
      });
      return;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:streamGenerateContent?alt=sse`;

    const payload = {
      contents: buildGeminiContents(messages),
      generationConfig: {
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7,
        maxOutputTokens: Number.isFinite(Number(maxOutputTokens))
          ? Number(maxOutputTokens)
          : 8192,
      },
    };

    if (typeof systemInstruction === 'string' && systemInstruction.trim().length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemInstruction.trim() }],
      };
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!upstream.ok) {
      const errorBody = await upstream.text();
      let errorMessage = `Gemini API error (${upstream.status})`;
      try {
        const parsed = JSON.parse(errorBody);
        if (parsed?.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        if (errorBody) errorMessage = errorBody;
      }

      writeSseEvent(res, 'error', {
        status: upstream.status,
        message: errorMessage,
      });
      return;
    }

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

          if (candidate?.finishReason) {
            lastFinishReason = candidate.finishReason;
          }

          if (chunk?.usageMetadata) {
            writeSseEvent(res, 'usage', chunk.usageMetadata);
          }
        } catch {
          // Abaikan JSON parsial
        }
      }
    }

    writeSseEvent(res, 'done', {
      model,
      finishReason: lastFinishReason || 'STOP',
      isDemo: false,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return;
    }
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
