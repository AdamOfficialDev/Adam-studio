export const config = {
  runtime: 'edge',
};

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';

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

          sendEvent('thought', {
            text: `Memproses di Vercel Edge Runtime dengan profil ${model}...`,
          });
          await sleep(160, request.signal);

          const demoReply = [
            `Respons **Demo SSE Mode** dari Vercel Edge Function untuk model \`${model}\`.\n\n`,
            `> **Prompt:** ${userText.replace(/\n/g, ' ')}\n\n`,
            '```html\n',
            '<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#09090b;color:#fff;font-family:sans-serif">',
            '<div style="padding:24px;border-radius:16px;border:1px solid #27272a;background:#18181b;text-align:center">',
            `<h3>Vercel Edge SSE Live</h3><p style="color:#a1a1aa">Model: ${model}</p>`,
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
            totalTokenCount: promptTokens + tokens.length,
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
          signal: request.signal,
        });

        if (!upstream.ok) {
          const errorBody = await upstream.text();
          let errorMessage = `Gemini API error (${upstream.status})`;
          try {
            const parsed = JSON.parse(errorBody);
            if (parsed?.error?.message) errorMessage = parsed.error.message;
          } catch {
            if (errorBody) errorMessage = errorBody;
          }
          sendEvent('error', { status: upstream.status, message: errorMessage });
          return;
        }

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
          model,
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
