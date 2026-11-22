import {
  GITHUB_TOOL_DECLARATIONS,
  buildProjectSystemSection,
  executeGitHubTool,
} from './_github.js';

export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const ROTATE_IMMEDIATELY_STATUSES = new Set([401, 403, 408, 429]);
const HARD_STOP_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'PROHIBITED_CONTENT',
  'SPII',
  'BLOCKLIST',
  'IMAGE_SAFETY',
]);

let roundRobinCursor = Math.floor(Math.random() * 1000);
const keyCooldownMap = new Map();

export function parseKeyPool(...sources) {
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

export function maskKeyLabel(key, idx) {
  const tail = key.length >= 4 ? key.slice(-4) : '****';
  return `Key #${idx + 1} (•••${tail})`;
}

export function sleep(ms, signal) {
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

function createLinkedTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

export function buildAttachmentParts(att) {
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

export function buildGeminiContents(messages) {
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

export function buildOrderedCandidateKeys(keys, excludeKeys = new Set()) {
  const now = Date.now();
  const start = roundRobinCursor % keys.length;
  roundRobinCursor = (roundRobinCursor + 1) % keys.length;

  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const ready = [];
  const cooling = [];
  const excluded = [];

  for (const item of rotated) {
    const origIdx = keys.indexOf(item);
    const coolUntil = keyCooldownMap.get(item) || 0;
    if (excludeKeys.has(item)) {
      excluded.push({ key: item, idx: origIdx });
    } else if (coolUntil > now) {
      cooling.push({ key: item, idx: origIdx });
    } else {
      ready.push({ key: item, idx: origIdx });
    }
  }

  return [...ready, ...cooling, ...excluded];
}

export function extractGeminiError(rawText, status) {
  let msg = `Gemini API error (${status})`;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed?.error?.message) msg = parsed.error.message;
  } catch {
    if (rawText) msg = rawText;
  }
  return msg;
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
  toolMode = 'AUTO',
  withToolConfig = true,
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
    if (withToolConfig && toolMode) {
      payload.toolConfig = {
        functionCallingConfig: { mode: toolMode },
      };
    }
  }

  return payload;
}

async function fetchGeminiWithRotationAndRetry({
  targetModel,
  apiKeys,
  excludeKeys = new Set(),
  contents,
  systemInstruction,
  temperature,
  maxOutputTokens,
  includeThoughts,
  thinkingBudget,
  withTools,
  toolMode = 'AUTO',
  signal,
  onStatus,
  onInfo,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    targetModel
  )}:streamGenerateContent?alt=sse`;

  let wantsThinking = Boolean(includeThoughts) && Number(thinkingBudget) !== 0;
  let enableTools = Boolean(withTools);
  let enableToolConfig = true;
  const orderedKeys = buildOrderedCandidateKeys(apiKeys, excludeKeys);
  const maxAttempts = orderedKeys.length > 1 ? Math.min(Math.max(orderedKeys.length, 4), 14) : 4;

  let keyPointer = 0;
  let lastStatus = 503;
  let lastErrorMessage = 'Semua API Key sedang sibuk atau terkena limit.';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const current = orderedKeys[keyPointer % orderedKeys.length];
    const keyLabel = maskKeyLabel(current.key, current.idx);
    const reqGuard = createLinkedTimeoutSignal(signal, 25_000);

    let upstream;
    try {
      upstream = await fetch(endpoint, {
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
            toolMode,
            withToolConfig: enableToolConfig,
          })
        ),
        signal: reqGuard.signal,
      });
    } catch (err) {
      reqGuard.cleanup();
      if (signal?.aborted) throw err;

      const isTimeout = reqGuard.didTimeout();
      lastStatus = isTimeout ? 504 : 502;
      lastErrorMessage = isTimeout
        ? `Koneksi ke ${targetModel} timeout (>25s) saat memakai ${keyLabel}.`
        : err instanceof Error
          ? `Koneksi jaringan terputus (${err.message})`
          : 'Gagal terhubung ke Gemini API.';

      keyCooldownMap.set(current.key, Date.now() + 15_000);

      if (attempt + 1 < maxAttempts) {
        if (orderedKeys.length > 1) {
          keyPointer += 1;
          const next = orderedKeys[keyPointer % orderedKeys.length];
          onStatus(
            `${lastErrorMessage} Merotasi ke ${maskKeyLabel(next.key, next.idx)} (${attempt + 2}/${maxAttempts})...`
          );
          await sleep(250, signal);
        } else {
          const delay = 1000 * Math.pow(2, attempt);
          onStatus(`${lastErrorMessage} Mencoba ulang dalam ${(delay / 1000).toFixed(1)}s...`);
          await sleep(delay, signal);
        }
        continue;
      }

      return { ok: false, status: lastStatus, message: lastErrorMessage, usedKey: current.key };
    }

    reqGuard.cleanup();

    if (upstream.ok) {
      if (attempt > 0 && orderedKeys.length > 1) {
        onInfo(`Berhasil terhubung menggunakan ${keyLabel} (pool ${orderedKeys.length} keys)`);
      }
      return {
        ok: true,
        response: upstream,
        usedModel: targetModel,
        usedKey: current.key,
        usedKeyLabel: keyLabel,
      };
    }

    const errBody = await upstream.text().catch(() => '');
    lastStatus = upstream.status;
    lastErrorMessage = extractGeminiError(errBody, upstream.status);

    if (upstream.status === 400 && wantsThinking && /thinking/i.test(errBody)) {
      wantsThinking = false;
      onInfo(`Model ${targetModel} tidak mendukung thinkingConfig; melanjutkan tanpa thinking.`);
      attempt -= 1;
      continue;
    }

    if (upstream.status === 400 && enableTools && enableToolConfig && /toolConfig|functionCallingConfig/i.test(errBody)) {
      enableToolConfig = false;
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
      (upstream.status === 400 && /api.?key|expired|invalid|quota/i.test(lastErrorMessage));

    const canRotateToAnotherKey = orderedKeys.length > 1;
    const isRetryable = RETRYABLE_STATUSES.has(upstream.status) || (isBadKey && canRotateToAnotherKey);

    if (isRetryable && attempt + 1 < maxAttempts) {
      const coolMs = isBadKey ? 120_000 : upstream.status === 429 ? 60_000 : 12_000;
      keyCooldownMap.set(current.key, Date.now() + coolMs);

      if (canRotateToAnotherKey) {
        keyPointer += 1;
        const nextCandidate = orderedKeys[keyPointer % orderedKeys.length];
        const nextLabel = maskKeyLabel(nextCandidate.key, nextCandidate.idx);
        const fastRotateDelay = ROTATE_IMMEDIATELY_STATUSES.has(upstream.status) || isBadKey ? 180 : 400;

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
          : 1100 * Math.pow(2, attempt) + Math.round(Math.random() * 400);

      onStatus(
        `Server ${targetModel} padat (${upstream.status}). Mencoba ulang (${attempt + 1}/${maxAttempts - 1}) dalam ${(baseDelay / 1000).toFixed(1)}s...`
      );
      await sleep(baseDelay, signal);
      continue;
    }

    return {
      ok: false,
      status: lastStatus,
      message: lastErrorMessage,
      usedKey: current.key,
    };
  }

  return { ok: false, status: lastStatus, message: lastErrorMessage };
}

async function readChunkWithIdleTimeout(reader, parentSignal, idleMs = 45_000) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('STREAM_IDLE_TIMEOUT'));
    }, idleMs);
  });
  const abortPromise = new Promise((_, reject) => {
    if (parentSignal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    parentSignal?.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true }
    );
  });

  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function consumeGeminiStream({ upstream, signal, sendEvent }) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const modelTurnParts = [];
  const functionCalls = [];
  let deltaText = '';
  let thoughtText = '';
  let finishReason;
  let streamError = null;

  const processBlock = (rawEvent) => {
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) return;
    const jsonString = dataLines.join('\n').trim();
    if (!jsonString || jsonString === '[DONE]') return;

    let chunk;
    try {
      chunk = JSON.parse(jsonString);
    } catch {
      return;
    }

    if (chunk?.error) {
      streamError = {
        status: Number(chunk.error.code) || 503,
        message: chunk.error.message || 'Gemini stream error di tengah respons.',
      };
      return;
    }

    const candidate = chunk?.candidates?.[0];
    const parts = candidate?.content?.parts;

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.thought && typeof part?.text === 'string' && part.text.length > 0) {
          thoughtText += part.text;
          sendEvent('thought', { text: part.text });
        } else if (part?.functionCall) {
          modelTurnParts.push(part);
          functionCalls.push(part.functionCall);
        } else if (typeof part?.text === 'string' && part.text.length > 0) {
          modelTurnParts.push(part);
          deltaText += part.text;
          sendEvent('delta', { text: part.text });
        }
      }
    }

    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (chunk?.usageMetadata) sendEvent('usage', chunk.usageMetadata);
  };

  try {
    while (true) {
      const { value, done } = await readChunkWithIdleTimeout(reader, signal, 45_000);
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundaryIndex;
      while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        processBlock(rawEvent);
        if (streamError) break;
      }

      if (streamError) break;
    }

    if (!streamError && buffer.trim()) {
      processBlock(buffer);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    streamError = {
      status: err instanceof Error && err.message === 'STREAM_IDLE_TIMEOUT' ? 504 : 502,
      message:
        err instanceof Error && err.message === 'STREAM_IDLE_TIMEOUT'
          ? 'Stream Gemini API berhenti merespons (>45 detik tanpa data).'
          : err instanceof Error
            ? `Stream terputus di tengah jalan: ${err.message}`
            : 'Stream upstream terputus.',
    };
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Abaikan
    }
  }

  return {
    modelTurnParts,
    functionCalls,
    deltaText,
    thoughtText,
    finishReason,
    streamError,
  };
}

export async function runResilientGeminiChat({
  model,
  apiKeys,
  messages,
  githubProject,
  githubToken,
  systemInstruction,
  temperature,
  maxOutputTokens,
  includeThoughts,
  thinkingBudget,
  autoFallbackOnOverload,
  fallbackModel,
  signal,
  sendEvent,
}) {
  const projectSection = buildProjectSystemSection(githubProject);
  const mergedSystemInstruction = [systemInstruction, projectSection].filter(Boolean).join('\n\n');
  const hasGitHubTools = Boolean(
    githubProject?.owner && githubProject?.repo && githubProject?.agenticToolsEnabled
  );

  const workingContents = buildGeminiContents(messages);
  let activeModel = model;
  let lastFinishReason;
  let totalAnswerText = '';
  let toolsHaveBeenUsed = false;

  const MAX_TOOL_ROUNDS = hasGitHubTools ? 6 : 1;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const allowToolsThisRound = hasGitHubTools && round < MAX_TOOL_ROUNDS - 1;
    const isFinalSynthesisRound = hasGitHubTools && !allowToolsThisRound;

    const failedKeysThisRound = new Set();
    let roundSuccess = false;
    let roundOutcome = null;
    let currentIncludeThoughts = Boolean(includeThoughts) && Number(thinkingBudget) !== 0;
    let currentMaxOutputTokens = Number(maxOutputTokens) || 8192;
    let currentToolMode = isFinalSynthesisRound ? 'NONE' : 'AUTO';

    for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt++) {
      const roundContents =
        isFinalSynthesisRound && recoveryAttempt === 0
          ? [
              ...workingContents,
              {
                role: 'user',
                parts: [
                  {
                    text: 'Semua file yang diperlukan sudah dibaca. Sekarang tulis jawaban lengkap dan terstruktur untuk pengguna tanpa memanggil tool lagi.',
                  },
                ],
              },
            ]
          : workingContents;

      const sendWithTools = hasGitHubTools && (allowToolsThisRound || toolsHaveBeenUsed);

      let result = await fetchGeminiWithRotationAndRetry({
        targetModel: activeModel,
        apiKeys,
        excludeKeys: failedKeysThisRound,
        contents: roundContents,
        systemInstruction: mergedSystemInstruction,
        temperature,
        maxOutputTokens: currentMaxOutputTokens,
        includeThoughts: currentIncludeThoughts,
        thinkingBudget,
        withTools: sendWithTools,
        toolMode: currentToolMode,
        signal,
        onStatus: (message) => sendEvent('status', { message }),
        onInfo: (message) => sendEvent('info', { message }),
      });

      if (
        !result.ok &&
        (RETRYABLE_STATUSES.has(result.status) || result.status >= 500) &&
        autoFallbackOnOverload &&
        fallbackModel &&
        fallbackModel !== activeModel
      ) {
        sendEvent('status', {
          message: `${activeModel} bermasalah (${result.status}). Beralih otomatis ke ${fallbackModel}...`,
        });
        sendEvent('info', {
          message: `Fallback otomatis ke ${fallbackModel} karena ${activeModel} sedang tidak stabil.`,
        });
        result = await fetchGeminiWithRotationAndRetry({
          targetModel: fallbackModel,
          apiKeys,
          excludeKeys: failedKeysThisRound,
          contents: roundContents,
          systemInstruction: mergedSystemInstruction,
          temperature,
          maxOutputTokens: currentMaxOutputTokens,
          includeThoughts: currentIncludeThoughts,
          thinkingBudget,
          withTools: sendWithTools,
          toolMode: currentToolMode,
          signal,
          onStatus: (message) => sendEvent('status', { message }),
          onInfo: (message) => sendEvent('info', { message }),
        });
      }

      if (!result.ok) {
        sendEvent('error', { status: result.status, message: result.message });
        return;
      }

      activeModel = result.usedModel;
      if (!result.response?.body) {
        if (result.usedKey) failedKeysThisRound.add(result.usedKey);
        if (recoveryAttempt < 2) continue;
        sendEvent('error', { status: 502, message: 'Stream respons dari Gemini API kosong.' });
        return;
      }

      roundOutcome = await consumeGeminiStream({
        upstream: result.response,
        signal,
        sendEvent,
      });

      if (roundOutcome.deltaText) {
        totalAnswerText += roundOutcome.deltaText;
      }
      if (roundOutcome.finishReason) {
        lastFinishReason = roundOutcome.finishReason;
      }

      const droppedWithoutFinish =
        !roundOutcome.finishReason &&
        !roundOutcome.streamError &&
        roundOutcome.functionCalls.length === 0;

      if (roundOutcome.streamError || droppedWithoutFinish) {
        if (result.usedKey) {
          keyCooldownMap.set(result.usedKey, Date.now() + 60_000);
          failedKeysThisRound.add(result.usedKey);
        }

        const errMsg =
          roundOutcome.streamError?.message ||
          'Koneksi stream terputus mendadak sebelum respons selesai.';
        const errStatus = roundOutcome.streamError?.status || 502;

        if (totalAnswerText.length > 0 && recoveryAttempt < 2) {
          sendEvent('status', {
            message: `${errMsg} Melanjutkan otomatis dengan key cadangan...`,
          });
          workingContents.push({ role: 'model', parts: [{ text: totalAnswerText }] });
          workingContents.push({
            role: 'user',
            parts: [
              {
                text: 'Koneksi sempat terputus di tengah jawaban. Lanjutkan responsmu PERSIS dari karakter terakhir di atas tanpa mengulang kalimat atau blok kode yang sudah ditulis.',
              },
            ],
          });
          currentToolMode = 'NONE';
          await sleep(300, signal);
          continue;
        }

        if (totalAnswerText.length === 0 && recoveryAttempt < 2) {
          sendEvent('status', {
            message: `${errMsg} Mencoba ulang otomatis dengan key lain...`,
          });
          if (
            recoveryAttempt === 1 &&
            autoFallbackOnOverload &&
            fallbackModel &&
            fallbackModel !== activeModel
          ) {
            activeModel = fallbackModel;
            sendEvent('info', {
              message: `Stream ${model} putus di tengah proses; beralih otomatis ke ${fallbackModel}.`,
            });
          }
          await sleep(350, signal);
          continue;
        }

        sendEvent('error', { status: errStatus, message: errMsg });
        return;
      }

      if (
        HARD_STOP_FINISH_REASONS.has(roundOutcome.finishReason) &&
        roundOutcome.deltaText.length === 0
      ) {
        sendEvent('error', {
          status: 422,
          message: `Model menghentikan respons karena kebijakan (${roundOutcome.finishReason}).`,
        });
        return;
      }

      const isEmptyTurn =
        roundOutcome.functionCalls.length === 0 && roundOutcome.deltaText.length === 0;

      if (isEmptyTurn || roundOutcome.finishReason === 'MALFORMED_FUNCTION_CALL') {
        if (recoveryAttempt < 2) {
          if (result.usedKey) failedKeysThisRound.add(result.usedKey);

          if (roundOutcome.finishReason === 'MAX_TOKENS') {
            currentIncludeThoughts = false;
            currentMaxOutputTokens = Math.max(currentMaxOutputTokens, 8192);
            sendEvent('status', {
              message: 'Token habis saat fase thinking. Mencoba ulang langsung ke jawaban...',
            });
          } else if (
            roundOutcome.finishReason === 'MALFORMED_FUNCTION_CALL' ||
            toolsHaveBeenUsed
          ) {
            currentToolMode = 'NONE';
            sendEvent('status', {
              message: 'Tool call tidak selesai. Meminta model menyusun jawaban dari data yang ada...',
            });
          } else {
            sendEvent('status', {
              message: 'Model mengembalikan respons kosong. Merotasi API key & mencoba ulang...',
            });
          }

          await sleep(300, signal);
          continue;
        }

        sendEvent('error', {
          status: 502,
          message: `Model selesai tanpa teks jawaban (${roundOutcome.finishReason || 'EMPTY_RESPONSE'}). Silakan coba ulangi atau ganti model.`,
        });
        return;
      }

      roundSuccess = true;
      break;
    }

    if (!roundSuccess || !roundOutcome) {
      sendEvent('error', {
        status: 502,
        message: 'Gagal mendapatkan respons utuh dari model setelah beberapa kali percobaan.',
      });
      return;
    }

    if (roundOutcome.functionCalls.length === 0 || !allowToolsThisRound) {
      break;
    }

    toolsHaveBeenUsed = true;
    workingContents.push({ role: 'model', parts: roundOutcome.modelTurnParts });

    const functionResponseParts = await Promise.all(
      roundOutcome.functionCalls.map(async (fc, idx) => {
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
          signal,
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

  if (totalAnswerText.trim().length === 0) {
    sendEvent('error', {
      status: 502,
      message: `Respons model kosong setelah menjalankan tools (${lastFinishReason || 'NO_TEXT'}).`,
    });
    return;
  }

  sendEvent('done', {
    model: activeModel,
    finishReason: lastFinishReason || 'STOP',
    isDemo: false,
  });
}
