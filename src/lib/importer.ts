import { estimateTokens, generateId } from '@/lib/utils';
import type { ChatMessage, CompactedContextState } from '@/types/chat';

export interface ParsedImportResult {
  ok: boolean;
  sourceLabel?: string;
  title?: string;
  model?: string;
  sessionSystemInstruction?: string;
  messages: ChatMessage[];
  estimatedTokens: number;
  error?: string;
}

function extractTextFromParts(parts: unknown): { content: string; thought: string } {
  if (!Array.isArray(parts)) return { content: '', thought: '' };
  const textParts: string[] = [];
  const thoughtParts: string[] = [];

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { text?: unknown; thought?: unknown; isThought?: unknown };
    if (typeof p.text !== 'string' || !p.text) continue;
    if (p.thought || p.isThought) {
      thoughtParts.push(p.text);
    } else {
      textParts.push(p.text);
    }
  }
  return {
    content: textParts.join(''),
    thought: thoughtParts.join(''),
  };
}

function cleanModelName(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return raw.trim().replace(/^models\//i, '');
}

export function condenseLongCodeBlocks(text: string, maxLines = 80): string {
  return text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (full, lang: string, body: string) => {
    const lines = body.split('\n');
    if (lines.length <= maxLines) return full;
    const preview = lines.slice(0, 12).join('\n');
    return `\`\`\`${lang}\n${preview}\n// ... [${lines.length - 12} baris kode ${lang || 'text'} diringkas]\n\`\`\``;
  });
}

// Pertahankan N blok kode besar terakhir secara utuh (zero-loss untuk kode terbaru & seluruh teks chat)
export function applyKeepLatestCodeToMessages(
  messages: ChatMessage[],
  keepLatestBlocks = 2
): ChatMessage[] {
  const codeBlockLocations: Array<{ msgIdx: number; matchIndex: number }> = [];
  const regex = /```[\w-]*\n[\s\S]*?```/g;

  messages.forEach((msg, msgIdx) => {
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(msg.content)) !== null) {
      if (m[0].split('\n').length > 25) {
        codeBlockLocations.push({ msgIdx, matchIndex: m.index });
      }
    }
  });

  if (codeBlockLocations.length <= keepLatestBlocks) {
    return messages;
  }

  const preserveSet = new Set(
    codeBlockLocations.slice(-keepLatestBlocks).map((loc) => `${loc.msgIdx}:${loc.matchIndex}`)
  );

  return messages.map((msg, msgIdx) => {
    let replaced = false;
    const nextContent = msg.content.replace(
      /```([\w-]*)\n([\s\S]*?)```/g,
      (full, lang: string, body: string, offset: number) => {
        const lineCount = body.split('\n').length;
        if (lineCount <= 25 || preserveSet.has(`${msgIdx}:${offset}`)) {
          return full;
        }
        replaced = true;
        return `[Versi kode ${lang || 'text'} lama (${lineCount} baris) sudah diperbarui pada versi terbaru di akhir percakapan]`;
      }
    );
    return replaced ? { ...msg, content: nextContent } : msg;
  });
}

export function estimateMessagesTokenTotal(messages: ChatMessage[]): number {
  return messages.reduce((acc, m) => {
    const attTokens = (m.attachments || []).reduce((s, a) => s + (a.tokenCount ?? 0), 0);
    const vtTokens = m.visualTarget ? estimateTokens(m.visualTarget.outerHtml) : 0;
    return acc + estimateTokens(m.content) + attTokens + vtTokens;
  }, 0);
}

export function buildEffectiveApiHistory(
  messages: ChatMessage[],
  compacted?: CompactedContextState
): ChatMessage[] {
  if (!compacted) return messages;

  if (compacted.mode === 'keep-latest-code') {
    return applyKeepLatestCodeToMessages(messages, 2);
  }

  const keepCount = Math.max(2, compacted.keepRecentCount);
  const recentRaw = messages.slice(-keepCount);
  const recentClean = applyKeepLatestCodeToMessages(recentRaw, 2);

  if (!compacted.summaryPrefix) {
    return recentClean;
  }

  const prefixMessages: ChatMessage[] = [
    {
      id: 'compacted-history-user',
      role: 'user',
      content: `[Ringkasan Konteks Historis Lengkap dari Sesi Sebelumnya]\n\n${compacted.summaryPrefix}`,
      createdAt: messages[0]?.createdAt ?? Date.now(),
    },
    {
      id: 'compacted-history-assistant',
      role: 'assistant',
      content:
        'Konteks historis lengkap dan spesifikasi proyek di atas sudah saya pahami sepenuhnya. Saya siap melanjutkan dari percakapan terbaru di bawah.',
      createdAt: messages[0]?.createdAt ?? Date.now(),
    },
  ];

  return [...prefixMessages, ...recentClean];
}

const MAX_COMPACT_BATCH_BYTES = 2_400_000;

export function buildCompactionChunks(messages: ChatMessage[], maxChunkTokens = 105_000): string[] {
  const deduped = applyKeepLatestCodeToMessages(messages, 1);
  const chunks: string[] = [];
  let currentText = '';
  let currentTokens = 0;

  const pushEntry = (entry: string) => {
    const entryTokens = estimateTokens(entry);
    if (entryTokens > maxChunkTokens) {
      if (currentText.trim()) {
        chunks.push(currentText.trim());
        currentText = '';
        currentTokens = 0;
      }
      const stepChars = Math.max(12_000, maxChunkTokens * 3);
      for (let pos = 0; pos < entry.length; pos += stepChars) {
        chunks.push(entry.slice(pos, pos + stepChars).trim());
      }
      return;
    }

    if (currentTokens + entryTokens > maxChunkTokens && currentText) {
      chunks.push(currentText.trim());
      currentText = entry;
      currentTokens = entryTokens;
    } else {
      currentText += entry;
      currentTokens += entryTokens;
    }
  };

  for (let i = 0; i < deduped.length; i++) {
    const m = deduped[i];
    const speaker = m.role === 'user' ? 'USER' : 'ASSISTANT';
    const attNotes =
      m.attachments && m.attachments.length > 0
        ? `\n[Lampiran: ${m.attachments.map((a) => `${a.name} (${a.mimeType})`).join(', ')}]`
        : '';
    const entry = `[Turn #${i + 1} - ${speaker}]\n${m.content}${attNotes}\n\n`;
    pushEntry(entry);
  }

  if (currentText.trim()) {
    chunks.push(currentText.trim());
  }
  return chunks;
}

async function runCompactBatchRequest(params: {
  model: string;
  chunks: string[];
  headers: Record<string, string>;
  signal?: AbortSignal;
  batchLabel?: string;
  onStatus?: (msg: string) => void;
}): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const res = await fetch('/api/compact', {
    method: 'POST',
    headers: params.headers,
    body: JSON.stringify({
      model: params.model,
      chunks: params.chunks,
    }),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: txt || `Gagal merangkum konteks (${res.status})` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalSummary = '';
  let errorMsg = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundaryIndex: number;
    while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawBlock = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      if (!rawBlock.trim() || rawBlock.startsWith(':')) continue;

      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of rawBlock.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }

      if (eventName === 'status' && typeof parsed.message === 'string') {
        params.onStatus?.(
          params.batchLabel ? `${params.batchLabel} ${parsed.message}` : parsed.message
        );
      } else if (eventName === 'result' && typeof parsed.summary === 'string') {
        finalSummary = parsed.summary;
      } else if (eventName === 'error' && typeof parsed.message === 'string') {
        errorMsg = parsed.message;
      }
    }
  }

  if (finalSummary) return { ok: true, summary: finalSummary };
  return { ok: false, error: errorMsg || 'Ringkasan gagal dihasilkan.' };
}

export async function runLosslessContextCompaction(params: {
  messages: ChatMessage[];
  keepRecentCount: number;
  model: string;
  apiKey?: string;
  existingSummary?: string;
  signal?: AbortSignal;
  onStatus?: (msg: string) => void;
}): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const olderMessages =
    params.messages.length > params.keepRecentCount
      ? params.messages.slice(0, -params.keepRecentCount)
      : params.messages;

  const chunks = buildCompactionChunks(olderMessages, 95_000);
  if (params.existingSummary?.trim()) {
    chunks.unshift(
      `[RINGKASAN KONTEKS HISTORIS SEBELUMNYA DARI AWAL SESI — WAJIB DIPERTAHANKAN UTUH]\n\n${params.existingSummary.trim()}`
    );
  }

  if (chunks.length === 0) {
    return { ok: false, error: 'Tidak ada pesan lama untuk dirangkum.' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const normalizedKeys = (params.apiKey || '')
    .split(/[\r\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (normalizedKeys.length > 0) {
    headers['x-gemini-api-key'] = normalizedKeys.join(',');
  }

  const encoder = new TextEncoder();
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBytes = 0;

  for (const chunk of chunks) {
    const chunkBytes = encoder.encode(chunk).length + 64;
    if (currentBatch.length > 0 && currentBytes + chunkBytes > MAX_COMPACT_BATCH_BYTES) {
      batches.push(currentBatch);
      currentBatch = [chunk];
      currentBytes = chunkBytes;
    } else {
      currentBatch.push(chunk);
      currentBytes += chunkBytes;
    }
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const summaries: string[] = [];
  for (let b = 0; b < batches.length; b++) {
    const label = batches.length > 1 ? `[Batch ${b + 1}/${batches.length}]` : undefined;
    const result = await runCompactBatchRequest({
      model: params.model,
      chunks: batches[b],
      headers,
      signal: params.signal,
      batchLabel: label,
      onStatus: params.onStatus,
    });
    if (!result.ok || !result.summary) {
      return result;
    }
    summaries.push(result.summary);
  }

  return { ok: true, summary: summaries.join('\n\n') };
}

function parseGoogleAiStudioJson(
  obj: Record<string, unknown>,
  fallbackTitle: string
): ParsedImportResult | null {
  const chunked = obj.chunkedPrompt as { chunks?: unknown[] } | undefined;
  if (!chunked || !Array.isArray(chunked.chunks)) return null;

  const messages: ChatMessage[] = [];
  let pendingThought = '';
  const now = Date.now();

  for (let i = 0; i < chunked.chunks.length; i++) {
    const rawChunk = chunked.chunks[i];
    if (!rawChunk || typeof rawChunk !== 'object') continue;
    const c = rawChunk as {
      role?: string;
      text?: string;
      isThought?: boolean;
      parts?: unknown[];
    };

    const roleRaw = (c.role || 'user').toLowerCase();
    const role: 'user' | 'assistant' =
      roleRaw === 'model' || roleRaw === 'assistant' ? 'assistant' : 'user';

    let text = typeof c.text === 'string' ? c.text : '';
    let thought = '';

    if (Array.isArray(c.parts)) {
      const extracted = extractTextFromParts(c.parts);
      if (!text) text = extracted.content;
      thought = extracted.thought;
    }

    if (c.isThought && role === 'assistant') {
      pendingThought += (pendingThought ? '\n' : '') + text;
      continue;
    }

    const combinedThought = [pendingThought, thought].filter(Boolean).join('\n').trim();
    pendingThought = '';

    if (!text.trim() && !combinedThought) continue;

    const prev = messages[messages.length - 1];
    if (prev && prev.role === role && role === 'assistant' && !prev.content && combinedThought) {
      prev.content = text;
      prev.thought = [prev.thought, combinedThought].filter(Boolean).join('\n');
      continue;
    }

    messages.push({
      id: generateId(),
      role,
      content: text.trim(),
      thought: combinedThought || undefined,
      createdAt: now + i,
    });
  }

  if (pendingThought && messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
    const last = messages[messages.length - 1];
    last.thought = [last.thought, pendingThought].filter(Boolean).join('\n');
  }

  if (messages.length === 0) return null;

  const runSettings = obj.runSettings as { model?: unknown } | undefined;
  const sysObj = obj.systemInstruction as { text?: unknown; parts?: unknown[] } | undefined;
  let sysText = typeof sysObj?.text === 'string' ? sysObj.text : '';
  if (!sysText && Array.isArray(sysObj?.parts)) {
    sysText = extractTextFromParts(sysObj.parts).content;
  }

  const totalTok = estimateMessagesTokenTotal(messages);

  return {
    ok: true,
    sourceLabel: 'Google AI Studio Drive JSON',
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackTitle,
    model: cleanModelName(runSettings?.model),
    sessionSystemInstruction: sysText.trim() || undefined,
    messages,
    estimatedTokens: totalTok,
  };
}

function parseChatGptMappingJson(
  obj: Record<string, unknown>,
  fallbackTitle: string
): ParsedImportResult | null {
  const mapping = obj.mapping as Record<string, unknown> | undefined;
  if (!mapping || typeof mapping !== 'object') return null;

  const nodes = Object.values(mapping).filter(
    (n): n is {
      message?: {
        author?: { role?: string };
        content?: { parts?: unknown[] };
        create_time?: number;
      };
    } => Boolean(n && typeof n === 'object')
  );

  nodes.sort((a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0));

  const messages: ChatMessage[] = [];
  for (const node of nodes) {
    const msg = node.message;
    if (!msg) continue;
    const roleRaw = msg.author?.role;
    if (roleRaw !== 'user' && roleRaw !== 'assistant') continue;
    const parts = Array.isArray(msg.content?.parts) ? msg.content.parts : [];
    const text = parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
    if (!text) continue;
    messages.push({
      id: generateId(),
      role: roleRaw,
      content: text,
      createdAt: msg.create_time ? Math.round(msg.create_time * 1000) : Date.now(),
    });
  }

  if (messages.length === 0) return null;

  return {
    ok: true,
    sourceLabel: 'ChatGPT Export JSON',
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackTitle,
    messages,
    estimatedTokens: estimateMessagesTokenTotal(messages),
  };
}

function parseGenericMessagesArray(
  arr: unknown[],
  sourceLabel: string,
  title: string,
  model?: string,
  sessionSystemInstruction?: string
): ParsedImportResult | null {
  const messages: ChatMessage[] = [];
  const now = Date.now();

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== 'object') continue;
    const m = item as {
      role?: string;
      content?: unknown;
      text?: unknown;
      thought?: unknown;
      parts?: unknown[];
      model?: unknown;
    };

    const roleRaw = (m.role || '').toLowerCase();
    if (roleRaw === 'system') continue;
    const role: 'user' | 'assistant' =
      roleRaw === 'assistant' || roleRaw === 'model' || roleRaw === 'ai' ? 'assistant' : 'user';

    let content = '';
    let thought = typeof m.thought === 'string' ? m.thought : '';

    if (typeof m.content === 'string') {
      content = m.content;
    } else if (typeof m.text === 'string') {
      content = m.text;
    } else if (Array.isArray(m.parts)) {
      const extracted = extractTextFromParts(m.parts);
      content = extracted.content;
      if (!thought) thought = extracted.thought;
    }

    if (!content.trim() && !thought.trim()) continue;
    messages.push({
      id: generateId(),
      role,
      content: content.trim(),
      thought: thought.trim() || undefined,
      model: cleanModelName(m.model),
      createdAt: now + i,
    });
  }

  if (messages.length === 0) return null;

  return {
    ok: true,
    sourceLabel,
    title,
    model,
    sessionSystemInstruction,
    messages,
    estimatedTokens: estimateMessagesTokenTotal(messages),
  };
}

function parseMarkdownChat(raw: string, fallbackTitle: string): ParsedImportResult {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const titleMatch = /^#\s+(.+)$/m.exec(text);
  const extractedTitle = titleMatch ? titleMatch[1].trim() : fallbackTitle;

  const roleHeaderRegex =
    /^(?:#{1,4}\s*|\*\*)(User|Pengguna|You|Assistant|Model|AI|Gemini|Claude)(?:\*\*)?:?\s*$/gim;

  const matches = Array.from(text.matchAll(roleHeaderRegex));
  const messages: ChatMessage[] = [];
  const now = Date.now();

  if (matches.length >= 1) {
    for (let i = 0; i < matches.length; i++) {
      const curr = matches[i];
      const next = matches[i + 1];
      const start = (curr.index ?? 0) + curr[0].length;
      const end = next ? (next.index ?? text.length) : text.length;
      const body = text.slice(start, end).trim();
      if (!body) continue;

      const label = curr[1].toLowerCase();
      const role: 'user' | 'assistant' =
        label === 'user' || label === 'pengguna' || label === 'you' ? 'user' : 'assistant';

      messages.push({
        id: generateId(),
        role,
        content: body,
        createdAt: now + i,
      });
    }
  }

  if (messages.length === 0) {
    messages.push({
      id: generateId(),
      role: 'user',
      content: `[Konteks Referensi dari Dokumen Markdown]\n\n${text}`,
      createdAt: now,
    });
    messages.push({
      id: generateId(),
      role: 'assistant',
      content:
        'Siap! Konteks dokumen di atas sudah saya pahami untuk sesi ini. Silakan lanjutkan pertanyaan atau instruksi berikutnya.',
      createdAt: now + 1,
    });
  }

  return {
    ok: true,
    sourceLabel: matches.length >= 1 ? 'Markdown Chat (.md)' : 'Markdown Context (.md)',
    title: extractedTitle.slice(0, 64),
    messages,
    estimatedTokens: estimateMessagesTokenTotal(messages),
  };
}

export function parseImportedChatContent(
  rawText: string,
  fileName = 'Imported Chat'
): ParsedImportResult {
  const trimmed = rawText.trim();
  const baseTitle = fileName.replace(/\.(json|md|txt)$/i, '') || 'Imported Chat';

  if (!trimmed) {
    return { ok: false, messages: [], estimatedTokens: 0, error: 'Konten masih kosong.' };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (Array.isArray(parsed)) {
        const res = parseGenericMessagesArray(parsed, 'Gemini / Chat Array JSON', baseTitle);
        if (res) return res;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;

        const aiStudioRes = parseGoogleAiStudioJson(obj, baseTitle);
        if (aiStudioRes) return aiStudioRes;

        if (Array.isArray(obj.messages)) {
          const res = parseGenericMessagesArray(
            obj.messages,
            'Adam Studio / Chat JSON',
            typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : baseTitle,
            cleanModelName(obj.model),
            typeof obj.sessionSystemInstruction === 'string'
              ? obj.sessionSystemInstruction
              : undefined
          );
          if (res) return res;
        }

        if (Array.isArray(obj.contents)) {
          const res = parseGenericMessagesArray(
            obj.contents,
            'Gemini API Contents JSON',
            baseTitle,
            cleanModelName(obj.model)
          );
          if (res) return res;
        }

        const gptRes = parseChatGptMappingJson(obj, baseTitle);
        if (gptRes) return gptRes;
      }

      return {
        ok: false,
        messages: [],
        estimatedTokens: 0,
        error:
          'Struktur JSON tidak dikenali. Pastikan berasal dari Google AI Studio (Drive JSON), Adam Studio Export, ChatGPT, atau array { role, content }.',
      };
    } catch (err) {
      return {
        ok: false,
        messages: [],
        estimatedTokens: 0,
        error: `JSON tidak valid: ${err instanceof Error ? err.message : 'Syntax error'}`,
      };
    }
  }

  return parseMarkdownChat(trimmed, baseTitle);
}
