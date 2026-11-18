import type { Attachment, TokenUsage } from '@/types/chat';

export interface StreamChatPayload {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    attachments?: Attachment[];
  }>;
  systemInstruction: string;
  temperature: number;
  maxOutputTokens: number;
  demoMode: boolean;
  apiKey?: string;
}

export interface StreamHandlers {
  signal: AbortSignal;
  onThought: (text: string) => void;
  onDelta: (text: string) => void;
  onUsage: (usage: TokenUsage) => void;
  onDone: (meta: { model: string; finishReason?: string; isDemo?: boolean }) => void;
  onError: (message: string) => void;
}

export async function streamChatCompletion(
  payload: StreamChatPayload,
  handlers: StreamHandlers
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (payload.apiKey?.trim()) {
    headers['x-gemini-api-key'] = payload.apiKey.trim();
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments?.map((a) => ({
          kind: a.kind,
          name: a.name,
          mimeType: a.mimeType,
          data: a.data,
          textContent: a.textContent,
        })),
      })),
      systemInstruction: payload.systemInstruction,
      temperature: payload.temperature,
      maxOutputTokens: payload.maxOutputTokens,
      demoMode: payload.demoMode,
    }),
    signal: handlers.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    handlers.onError(errText || `HTTP Error ${response.status}`);
    return;
  }

  if (!response.body) {
    handlers.onError('Browser tidak menerima ReadableStream dari server.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (dataLines.length === 0) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }

      if (eventName === 'thought' && typeof parsed.text === 'string') {
        handlers.onThought(parsed.text);
      } else if (eventName === 'delta' && typeof parsed.text === 'string') {
        handlers.onDelta(parsed.text);
      } else if (eventName === 'usage') {
        handlers.onUsage(parsed as TokenUsage);
      } else if (eventName === 'done') {
        handlers.onDone({
          model: String(parsed.model ?? payload.model),
          finishReason: typeof parsed.finishReason === 'string' ? parsed.finishReason : undefined,
          isDemo: Boolean(parsed.isDemo),
        });
      } else if (eventName === 'error') {
        handlers.onError(
          typeof parsed.message === 'string'
            ? parsed.message
            : 'Terjadi kesalahan pada stream SSE.'
        );
      }
    }
  }
}
