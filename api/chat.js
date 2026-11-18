export const config = {
  runtime: 'edge',
};

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

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
    systemInstruction = '',
    temperature = 0.7,
    maxOutputTokens = 8192,
    includeThoughts = true,
    thinkingBudget = -1,
    autoFallbackOnOverload = false,
    fallbackModel = 'gemini-2.5-pro',
    demoMode = false,
  } = body || {};

  const headerKey = request.headers.get('x-gemini-api-key')?.trim() || '';
  const apiKey = headerKey || process.env.GEMINI_API_KEY?.trim() || '';
  const useDemo = Boolean(demoMode) || (process.env.DEMO_MODE === 'true' && !apiKey);

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
              `- Menyiapkan jawaban terstruktur dengan arsitektur auto-retry 503/429.`,
            ].join('');

            const tTokens = demoThought.match(/\S+\s*/g) || [demoThought];
            for (const chunk of tTokens) {
              await sleep(24, request.signal);
              sendEvent('thought', { text: chunk });
            }
          }

          const demoReply = [
            `Respons **Demo SSE Mode** dari Vercel Edge Function untuk model \`${model}\`.\n\n`,
            `> **Prompt:** ${userText.replace(/\n/g, ' ')}\n`,
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

        if (!apiKey) {
          sendEvent('error', {
            status: 401,
            message:
              'GEMINI_API_KEY belum diset di Environment Variables Vercel. Tambahkan di Project Settings Vercel, masukkan lewat Settings UI, atau aktifkan Demo SSE Mode.',
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
          signal: request.signal,
          onStatus: (message) => sendEvent('status', { message }),
          onInfo: (message) => sendEvent('info', { message }),
        });

        if (
          !result.ok &&
          RETRYABLE_STATUSES.has(result.status) &&
          autoFallbackOnOverload &&
          fallbackModel &&
          fallbackModel !== model
        ) {
          sendEvent('status', {
            message: `${model} masih penuh (${result.status}). Beralih otomatis ke ${fallbackModel}...`,
          });
          sendEvent('info', {
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
        const activeModel = result.usedModel;

        if (!upstream.body) {
          sendEvent('error', { status: 502, message: 'Stream respons Gemini kosong.' });
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
                    sendEvent('thought', { text: part.text });
                  } else if (typeof part?.text === 'string' && part.text.length > 0) {
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
