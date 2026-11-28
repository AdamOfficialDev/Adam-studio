import { parseKeyPool, runResilientGeminiChat, sleep } from './_gemini.js';

export const config = {
  runtime: 'edge',
};

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gemini-4-hydrogen';

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
    builderMode = 'chat',
    deviceId = '',
    deviceApprovalMode = 'high-risk',
    workspaceSnapshot = null,
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
  } = body || {};

  const headerKeys = parseKeyPool(
    request.headers.get('x-gemini-api-keys') || '',
    request.headers.get('x-gemini-api-key') || ''
  );
  const envKeys = parseKeyPool(process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY);
  const apiKeys = headerKeys.length > 0 ? headerKeys : envKeys;
  const githubToken =
    request.headers.get('x-github-token')?.trim() || process.env.GITHUB_TOKEN?.trim() || '';
  const daytonaApiKey =
    request.headers.get('x-daytona-api-key')?.trim() || process.env.DAYTONA_API_KEY?.trim() || '';
  const daytonaApiUrl =
    request.headers.get('x-daytona-api-url')?.trim() || process.env.DAYTONA_API_URL?.trim() || '';

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

      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, 8_000);

      try {
        if (!Array.isArray(messages) || messages.length === 0) {
          sendEvent('error', { status: 400, message: 'Pesan tidak boleh kosong.' });
          return;
        }

        if (useDemo) {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
          const userText = lastUserMsg?.content?.trim() || 'Demo Vercel SSE';
          const showThoughts =
            Boolean(includeThoughts) && String(thinkingLevel || '').toLowerCase() !== 'off';

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

        await runResilientGeminiChat({
          model,
          apiKeys,
          messages,
          githubProject,
          githubToken,
          daytonaApiKey,
          daytonaApiUrl,
          builderMode,
          deviceId,
          deviceApprovalMode,
          workspaceSnapshot,
          systemInstruction,
          maxOutputTokens,
          includeThoughts,
          thinkingLevel,
          autoFallbackOnOverload,
          fallbackModel,
          enableGoogleSearch,
          enableUrlContext,
          continueFrom,
          signal: request.signal,
          sendEvent,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        sendEvent('error', {
          status: 500,
          message: err instanceof Error ? err.message : 'Internal Edge Function Error',
        });
      } finally {
        clearInterval(heartbeatTimer);
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
