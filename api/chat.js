import {
  GITHUB_TOOL_DECLARATIONS,
  buildProjectSystemSection,
  executeGitHubTool,
} from './_github.js';

export const config = {
  runtime: 'edge',
};

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const ROTATE_IMMEDIATELY_STATUSES = new Set([401, 403, 429]);

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

function maskKeyLabel(key, idx) {
  const tail = key.length >= 4 ? key.slice(-4) : '****';
  return `Key #${idx + 1} (•••${tail})`;
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
  contents,
  systemInstruction,
  temperature,
  maxOutputTokens,
  includeThoughts,
  thinkingBudget,
  withThinkingConfig,
  withTools,
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
    contents,
    generationConfig,
  };

  if (typeof systemInstruction === 'string' && systemInstruction.trim().length > 0) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction.trim() }],
    };
  }

  if (withTools) {
    payload.tools = [{ functionDeclarations: GITHUB_TOOL_DECLARATIONS }];
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
  contents,
  systemInstruction,
  temperature,
  maxOutputTokens,
  includeThoughts,
  thinkingBudget,
  withTools,
  signal,
  onStatus,
  onInfo,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    targetModel
  )}:streamGenerateContent?alt=sse`;

  let wantsThinking = Boolean(includeThoughts) && Number(thinkingBudget) !== 0;
  let enableTools = Boolean(withTools);
  const orderedKeys = buildOrderedCandidateKeys(apiKeys);
  const maxAttempts = orderedKeys.length > 1 ? orderedKeys.length : 4;

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
          contents,
          systemInstruction,
          temperature,
          maxOutputTokens,
          includeThoughts,
          thinkingBudget,
          withThinkingConfig: wantsThinking,
          withTools: enableTools,
        })
      ),
      signal,
    });

    if (upstream.ok) {
      if (attempt > 0 && orderedKeys.length > 1) {
        onInfo(`Berhasil terhubung menggunakan ${keyLabel} (pool ${orderedKeys.length} keys)`);
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

    if (upstream.status === 400 && enableTools && /tool|function/i.test(errBody)) {
      enableTools = false;
      onInfo(`Model ${targetModel} tidak mendukung function calling; melanjutkan tanpa GitHub tools.`);
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
        const fastRotateDelay = ROTATE_IMMEDIATELY_STATUSES.has(upstream.status) || isBadKey ? 200 : 450;

        onStatus(
          `${keyLabel} terkena (${upstream.status}). Merotasi ke ${nextLabel} (${attempt + 2}/${maxAttempts})...`
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

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const {
    model = DEFAULT_MODEL,
    messages = [],
    githubProject,
    systemInstruction = '',
    temperature = 0.7,
    maxOutputTokens = 8192,
    includeThoughts = true,
    thinkingBudget = -1,
    autoFallbackOnOverload = false,
    fallbackModel = 'gemini-3.8-flash',
    demoMode = false,
  } = body || {};

  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const apiKeys = headerKeys.length > 0 ? headerKeys : envKeys;
  const githubToken =
    request.headers.get('x-github-token')?.trim() || process.env.GITHUB_TOKEN?.trim() || '';

  const useDemo = Boolean(demoMode) || (process.env.DEMO_MODE === 'true' && apiKeys.length === 0);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event, data) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream sudah ditutup
        }
      };

      try {
        if (!Array.isArray(messages) || messages.length === 0) {
          sendEvent('error', { status: 400, message: 'Pesan tidak boleh kosong.' });
          return;
        }

        if (useDemo) {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
          const userText = lastUserMsg?.content?.trim() || 'Demo Vercel SSE';
          const showThoughts = Boolean(includeThoughts) && Number(thinkingBudget) !== 0;

          if (showThoughts) {
            const demoThought = [
              `**1. Analisis Permintaan di Edge Function**\n`,
              `Memahami prompt: "${userText.slice(0, 100)}".\n\n`,
              `**2. Perencanaan Komponen (${model})**\n`,
              `- Menyiapkan HTML Artifact untuk uji **Visual Inspector** & **Time-Machine Diff**.`,
            ].join('');

            const tTokens = demoThought.match(/\S+\s*/g) || [demoThought];
            for (const chunk of tTokens) {
              await sleep(20, request.signal);
              sendEvent('thought', { text: chunk });
            }
          }

          const demoReply = [
            `Respons **Demo SSE Mode** dari Vercel Edge Function untuk \`${model}\`.\n\n`,
            '```html\n',
            '<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#09090b;color:#fff;font-family:sans-serif">',
            '<div style="padding:24px;border-radius:16px;border:1px solid #27272a;background:#18181b;text-align:center">',
            '<h3>Adam Studio</h3><button style="margin-top:12px;padding:10px 16px;border-radius:10px;border:0;background:#3b82f6;color:#fff;font-weight:600">Inspect Tombol Ini</button>',
            '</div></body></html>\n',
            '```\n',
          ].join('');

          const tokens = demoReply.match(/\S+\s*/g) || [demoReply];
          for (const token of tokens) {
            await sleep(16, request.signal);
            sendEvent('delta', { text: token });
          }

          const promptTokens = Math.max(24, Math.ceil(userText.length / 3));
          sendEvent('usage', {
            promptTokenCount: promptTokens,
            candidatesTokenCount: tokens.length,
            thoughtsTokenCount: showThoughts ? 40 : 0,
            totalTokenCount: promptTokens + tokens.length + (showThoughts ? 40 : 0),
          });
          sendEvent('done', { model, finishReason: 'STOP', isDemo: true });
          return;
        }

        if (apiKeys.length === 0) {
          sendEvent('error', {
            status: 401,
            message:
              'Belum ada GEMINI_API_KEY. Isi 1 atau banyak key di Settings → Koneksi (atau Environment Variables Vercel), atau aktifkan Demo SSE Mode.',
          });
          return;
        }

    const projectSection = buildProjectSystemSection(githubProject);
    const mergedSystemInstruction = [systemInstruction, projectSection].filter(Boolean).join('\n\n');
    const hasGitHubTools = Boolean(
      githubProject?.owner && githubProject?.repo && githubProject?.agenticToolsEnabled
    );
    const workingContents = buildGeminiContents(messages);
    let activeModel = model;
    let lastFinishReason = undefined;
    const MAX_TOOL_ROUNDS = hasGitHubTools ? 3 : 1;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const allowToolsThisRound = hasGitHubTools && round < MAX_TOOL_ROUNDS - 1;
      let result = await fetchGeminiWithRotationAndRetry({
        targetModel: activeModel,
        apiKeys,
        contents: workingContents,
        systemInstruction: mergedSystemInstruction,
        temperature,
        maxOutputTokens,
        includeThoughts,
        thinkingBudget,
        withTools: allowToolsThisRound,
        signal: request.signal,
        onStatus: (message) => sendEvent('status', { message }),
        onInfo: (message) => sendEvent('info', { message }),
      });

      if (
        !result.ok &&
        RETRYABLE_STATUSES.has(result.status) &&
        autoFallbackOnOverload &&
        fallbackModel &&
        fallbackModel !== activeModel
      ) {
        sendEvent('status', {
          message: `${activeModel} masih penuh (${result.status}). Beralih otomatis ke ${fallbackModel}...`,
        });
        sendEvent('info', {
          message: `Fallback otomatis ke ${fallbackModel} karena ${activeModel} mengalami high demand.`,
        });
        result = await fetchGeminiWithRotationAndRetry({
          targetModel: fallbackModel,
          apiKeys,
          contents: workingContents,
          systemInstruction: mergedSystemInstruction,
          temperature,
          maxOutputTokens,
          includeThoughts,
          thinkingBudget,
          withTools: allowToolsThisRound,
          signal: request.signal,
          onStatus: (message) => sendEvent('status', { message }),
          onInfo: (message) => sendEvent('info', { message }),
        });
      }

      if (!result.ok) {
        sendEvent('error', { status: result.status, message: result.message });
        return;
      }

      const upstream = result.response;
      activeModel = result.usedModel;

      if (!upstream.body) {
        sendEvent('error', { status: 502, message: 'Stream respons dari Gemini API kosong.' });
        return;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const modelTurnParts = [];
      const functionCalls = [];

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
                  sendEvent('thought', { text: part.text });
                } else if (part?.functionCall) {
                  modelTurnParts.push(part);
                  functionCalls.push(part.functionCall);
                } else if (typeof part?.text === 'string' && part.text.length > 0) {
                  modelTurnParts.push(part);
                  sendEvent('delta', { text: part.text });
                }
              }
            }

            if (candidate?.finishReason) lastFinishReason = candidate.finishReason;
            if (chunk?.usageMetadata) sendEvent('usage', chunk.usageMetadata);
          } catch {
            // Abaikan JSON parsial
          }
        }
      }

      if (functionCalls.length === 0 || !allowToolsThisRound) {
        break;
      }

      workingContents.push({ role: 'model', parts: modelTurnParts });

      const functionResponseParts = await Promise.all(
        functionCalls.map(async (fc, idx) => {
          const callId = `tool-${round}-${idx}-${Date.now()}`;
          const argsSummary =
            fc.name === 'github_read_file'
              ? String(fc.args?.path || '')
              : fc.name === 'github_search_code'
                ? String(fc.args?.query || '')
                : String(fc.args?.prefix || 'root');

          sendEvent('tool_call', { id: callId, name: fc.name, argsSummary, status: 'running' });

          const toolOutcome = await executeGitHubTool({
            name: fc.name,
            args: fc.args,
            githubProject,
            githubToken,
            signal: request.signal,
          });

          sendEvent('tool_result', {
            id: callId,
            name: fc.name,
            argsSummary,
            status: toolOutcome.ok ? 'done' : 'error',
            resultSummary: toolOutcome.summary,
          });

          return {
            functionResponse: {
              name: fc.name,
              response: toolOutcome.response,
            },
          };
        })
      );

      workingContents.push({ role: 'user', parts: functionResponseParts });
    }

        sendEvent('done', {
          model: activeModel,
          finishReason: lastFinishReason || 'STOP',
          isDemo: false,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        sendEvent('error', {
          status: 500,
          message: err instanceof Error ? err.message : 'Internal Edge Function Error',
        });
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
