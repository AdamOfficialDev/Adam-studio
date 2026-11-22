import type { Attachment, GitHubProjectContext, TokenUsage, ToolTraceItem, VisualTarget } from '@/types/chat';

export interface StreamChatPayload {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    visualTarget?: VisualTarget;
    attachments?: Attachment[];
  }>;
  githubProject?: GitHubProjectContext;
  githubToken?: string;
  systemInstruction: string;
  temperature: number;
  maxOutputTokens: number;
  includeThoughts: boolean;
  thinkingBudget: number;
  autoFallbackOnOverload: boolean;
  fallbackModel: string;
  demoMode: boolean;
  apiKey?: string;
}

export interface StreamHandlers {
  signal: AbortSignal;
  onThought: (text: string) => void;
  onDelta: (text: string) => void;
  onUsage: (usage: TokenUsage) => void;
  onToolCall?: (item: ToolTraceItem) => void;
  onToolResult?: (item: ToolTraceItem) => void;
  onStatus?: (message: string) => void;
  onInfo?: (message: string) => void;
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

  const normalizedKeys = (payload.apiKey || '')
    .split(/[\r\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  if (normalizedKeys.length > 0) {
    headers['x-gemini-api-key'] = normalizedKeys.join(',');
  }

  if (payload.githubToken?.trim()) {
    headers['x-github-token'] = payload.githubToken.trim();
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages.map((m) => {
        const textContent = m.visualTarget
          ? `[Visual Target Element: \`${m.visualTarget.selector}\`]\n\`\`\`html\n${m.visualTarget.outerHtml}\n\`\`\`\n\n${m.content}`
          : m.content;
        return {
          role: m.role,
          content: textContent,
          attachments: m.attachments?.map((a) => ({
            kind: a.kind,
            name: a.name,
            mimeType: a.mimeType,
            data: a.data,
            textContent: a.textContent,
          })),
        };
      }),
      githubProject: payload.githubProject
        ? {
            owner: payload.githubProject.owner,
            repo: payload.githubProject.repo,
            branch: payload.githubProject.branch,
            treePaths: payload.githubProject.treePaths,
            pinnedFiles: payload.githubProject.pinnedFiles,
            agenticToolsEnabled: payload.githubProject.agenticToolsEnabled,
          }
        : undefined,
      systemInstruction: payload.systemInstruction,
      temperature: payload.temperature,
      maxOutputTokens: payload.maxOutputTokens,
      includeThoughts: payload.includeThoughts,
      thinkingBudget: payload.thinkingBudget,
      autoFallbackOnOverload: payload.autoFallbackOnOverload,
      fallbackModel: payload.fallbackModel,
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
  let receivedTerminalEvent = false;

  const processBlock = (rawBlock: string) => {
    if (!rawBlock.trim() || rawBlock.startsWith(':')) return;

    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of rawBlock.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }

    if (eventName === 'thought' && typeof parsed.text === 'string') {
      handlers.onThought(parsed.text);
    } else if (eventName === 'delta' && typeof parsed.text === 'string') {
      handlers.onDelta(parsed.text);
    } else if (eventName === 'tool_call') {
      handlers.onToolCall?.(parsed as unknown as ToolTraceItem);
    } else if (eventName === 'tool_result') {
      handlers.onToolResult?.(parsed as unknown as ToolTraceItem);
    } else if (eventName === 'usage') {
      handlers.onUsage(parsed as TokenUsage);
    } else if (eventName === 'status' && typeof parsed.message === 'string') {
      handlers.onStatus?.(parsed.message);
    } else if (eventName === 'info' && typeof parsed.message === 'string') {
      handlers.onInfo?.(parsed.message);
    } else if (eventName === 'done') {
      receivedTerminalEvent = true;
      handlers.onDone({
        model: String(parsed.model ?? payload.model),
        finishReason: typeof parsed.finishReason === 'string' ? parsed.finishReason : undefined,
        isDemo: Boolean(parsed.isDemo),
      });
    } else if (eventName === 'error') {
      receivedTerminalEvent = true;
      handlers.onError(
        typeof parsed.message === 'string'
          ? parsed.message
          : 'Terjadi kesalahan pada stream SSE.'
      );
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundaryIndex: number;
    while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawBlock = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      processBlock(rawBlock);
    }
  }

  if (buffer.trim()) {
    processBlock(buffer);
  }

  if (!receivedTerminalEvent && !handlers.signal.aborted) {
    handlers.onError(
      'Koneksi stream SSE terputus mendadak sebelum server selesai mengirim respons (timeout / jaringan terputus).'
    );
  }
}
