import type { Attachment, BuilderMode, EmergentClarification, EmergentPlan, GitHubProjectContext, GroundingMetadataInfo, ThinkingLevel, TokenUsage, ToolTraceItem, VirtualWorkspace, VisualTarget } from '@/types/chat';

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
  daytonaApiKey?: string;
  daytonaApiUrl?: string;
  builderMode?: BuilderMode;
  workspace?: VirtualWorkspace;
  systemInstruction: string;
  maxOutputTokens: number;
  includeThoughts: boolean;
  thinkingLevel: ThinkingLevel;
  enableGoogleSearch?: boolean;
  enableUrlContext?: boolean;
  autoFallbackOnOverload: boolean;
  fallbackModel: string;
  demoMode: boolean;
  apiKey?: string;
  continueFrom?: {
    partialContent?: string;
    partialThought?: string;
    completedTools?: Array<{
      name: string;
      argsSummary: string;
      status: string;
      resultSummary?: string;
    }>;
  };
}

export interface StreamHandlers {
  signal: AbortSignal;
  onThought: (text: string) => void;
  onDelta: (text: string) => void;
  onUsage: (usage: TokenUsage) => void;
  onGrounding?: (grounding: GroundingMetadataInfo) => void;
  onToolCall?: (item: ToolTraceItem) => void;
  onToolResult?: (item: ToolTraceItem) => void;
  onWorkspacePlan?: (plan: EmergentPlan) => void;
  onWorkspaceClarification?: (clarification: EmergentClarification) => void;
  onWorkspaceFile?: (evt: { action: 'write' | 'delete'; path: string; content?: string; language?: string }) => void;
  onWorkspaceSandbox?: (evt: { sandboxId?: string; previewUrl?: string; previewToken?: string }) => void;
  onStatus?: (message: string) => void;
  onInfo?: (message: string) => void;
  onDone: (meta: { model: string; finishReason?: string; isDemo?: boolean }) => void;
  onError: (message: string) => void;
}

const MAX_VERCEL_SAFE_BYTES = 4_000_000;
const utf8Encoder = new TextEncoder();

function buildSafeChatPayloadJson(payload: StreamChatPayload): { json: string; bytes: number } {
  const serialize = (
    msgs: StreamChatPayload['messages'],
    opts: {
      stripOlderAttachments?: boolean;
      maxTreePaths?: number;
      maxPinnedChars?: number;
      maxMsgChars?: number;
    } = {}
  ) => {
    const lastIdx = msgs.length - 1;
    const mappedMessages = msgs.map((m, idx) => {
      const baseText = m.visualTarget
        ? `[Visual Target Element: \`${m.visualTarget.selector}\`]\n\`\`\`html\n${m.visualTarget.outerHtml}\n\`\`\`\n\n${m.content}`
        : m.content;
      const content =
        opts.maxMsgChars && idx < lastIdx && baseText.length > opts.maxMsgChars
          ? `${baseText.slice(0, opts.maxMsgChars)}\n\n...[isi pesan lama dipotong agar muat batas payload server]`
          : baseText;

      const stripOlder = Boolean(opts.stripOlderAttachments) && idx < lastIdx;
      const strippedNotes: string[] = [];

      const attachments = stripOlder
        ? m.attachments
            ?.map((a) => {
              if (a.data) {
                strippedNotes.push(`[Lampiran terdahulu: ${a.name} (${a.mimeType})]`);
                return null;
              }
              if (a.textContent && a.textContent.length > 12_000) {
                return {
                  kind: a.kind,
                  name: a.name,
                  mimeType: a.mimeType,
                  textContent: `${a.textContent.slice(0, 12_000)}\n...[dipotong]`,
                };
              }
              return {
                kind: a.kind,
                name: a.name,
                mimeType: a.mimeType,
                textContent: a.textContent,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
        : m.attachments?.map((a) => ({
            kind: a.kind,
            name: a.name,
            mimeType: a.mimeType,
            data: a.data,
            textContent: a.textContent,
          }));

      const finalContent =
        strippedNotes.length > 0
          ? `${content}${content ? '\n\n' : ''}${strippedNotes.join('\n')}`
          : content;

      return {
        role: m.role,
        content: finalContent,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      };
    });

    const gh = payload.githubProject
      ? {
          owner: payload.githubProject.owner,
          repo: payload.githubProject.repo,
          branch: payload.githubProject.branch,
          commitSha: payload.githubProject.commitSha,
          treePaths: opts.maxTreePaths
            ? payload.githubProject.treePaths.slice(0, opts.maxTreePaths)
            : payload.githubProject.treePaths,
          pinnedFiles: opts.maxPinnedChars
            ? payload.githubProject.pinnedFiles.map((f) =>
                f.content.length > opts.maxPinnedChars!
                  ? { ...f, content: `${f.content.slice(0, opts.maxPinnedChars!)}\n// ...[dipotong]` }
                  : f
              )
            : payload.githubProject.pinnedFiles,
          agenticToolsEnabled: payload.githubProject.agenticToolsEnabled,
        }
      : undefined;

    const wsSnapshot = payload.workspace
      ? {
          files: payload.workspace.files,
          plan: payload.workspace.plan,
          entryPath: payload.workspace.entryPath,
          daytonaSandboxId: payload.workspace.daytonaSandboxId,
        }
      : undefined;

    return JSON.stringify({
      model: payload.model,
      messages: mappedMessages,
      githubProject: gh,
      builderMode: payload.builderMode || 'chat',
      workspaceSnapshot: wsSnapshot,
      systemInstruction: payload.systemInstruction,
      maxOutputTokens: payload.maxOutputTokens,
      includeThoughts: payload.includeThoughts,
      thinkingLevel: payload.thinkingLevel,
      enableGoogleSearch: Boolean(payload.enableGoogleSearch),
      enableUrlContext: Boolean(payload.enableUrlContext),
      autoFallbackOnOverload: payload.autoFallbackOnOverload,
      fallbackModel: payload.fallbackModel,
      demoMode: payload.demoMode,
      continueFrom: payload.continueFrom,
    });
  };

  const measure = (json: string) => ({ json, bytes: utf8Encoder.encode(json).length });

  let candidate = measure(serialize(payload.messages));
  if (candidate.bytes <= MAX_VERCEL_SAFE_BYTES) return candidate;

  candidate = measure(serialize(payload.messages, { stripOlderAttachments: true }));
  if (candidate.bytes <= MAX_VERCEL_SAFE_BYTES) return candidate;

  candidate = measure(
    serialize(payload.messages, {
      stripOlderAttachments: true,
      maxTreePaths: 200,
      maxPinnedChars: 24_000,
      maxMsgChars: 24_000,
    })
  );
  if (candidate.bytes <= MAX_VERCEL_SAFE_BYTES) return candidate;

  let trimmed = [...payload.messages];
  while (trimmed.length > 1) {
    trimmed = trimmed.slice(1);
    candidate = measure(
      serialize(trimmed, {
        stripOlderAttachments: true,
        maxTreePaths: 150,
        maxPinnedChars: 12_000,
        maxMsgChars: 12_000,
      })
    );
    if (candidate.bytes <= MAX_VERCEL_SAFE_BYTES) return candidate;
  }

  return candidate;
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
  if (payload.daytonaApiKey?.trim()) {
    headers['x-daytona-api-key'] = payload.daytonaApiKey.trim();
  }
  if (payload.daytonaApiUrl?.trim()) {
    headers['x-daytona-api-url'] = payload.daytonaApiUrl.trim();
  }

  const { json: safeBody, bytes: payloadBytes } = buildSafeChatPayloadJson(payload);
  if (payloadBytes > 4_350_000) {
    const sizeMb = (payloadBytes / (1024 * 1024)).toFixed(2);
    handlers.onError(
      `Ukuran payload (${sizeMb} MB) melebihi batas maksimal server Vercel (4.5 MB). Kecilkan atau kurangi jumlah lampiran pada pesan ini.`
    );
    return;
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: safeBody,
    signal: handlers.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    if (
      response.status === 413 ||
      /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(errText)
    ) {
      handlers.onError(
        'Ukuran payload melebihi batas 4.5 MB Vercel (HTTP 413). Kurangi ukuran atau jumlah lampiran lalu coba lagi.'
      );
      return;
    }
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
    } else if (eventName === 'workspace_plan' && parsed.plan) {
      handlers.onWorkspacePlan?.(parsed.plan as unknown as EmergentPlan);
    } else if (eventName === 'workspace_clarification' && parsed.clarification) {
      handlers.onWorkspaceClarification?.(parsed.clarification as unknown as EmergentClarification);
    } else if (eventName === 'workspace_file' && typeof parsed.path === 'string') {
      handlers.onWorkspaceFile?.(parsed as unknown as { action: 'write' | 'delete'; path: string; content?: string; language?: string });
    } else if (eventName === 'workspace_sandbox') {
      handlers.onWorkspaceSandbox?.(parsed as unknown as { sandboxId?: string; previewUrl?: string; previewToken?: string });
    } else if (eventName === 'grounding' && parsed.grounding) {
      handlers.onGrounding?.(parsed.grounding as unknown as GroundingMetadataInfo);
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
