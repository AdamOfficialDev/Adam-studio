export type CommitMessageStyle = 'short' | 'detail';

export interface WorkspaceCommitFile {
  path: string;
  content: string;
}

export interface GenerateCommitOptions {
  files: WorkspaceCommitFile[];
  repoName?: string;
  branch?: string;
  style: CommitMessageStyle;
  model: string;
  customContext?: string;
  apiKey?: string;
  demoMode?: boolean;
  signal?: AbortSignal;
  onStream?: (partialText: string) => void;
}

export interface GenerateCommitResult {
  message: string;
  usedFallback: boolean;
  modelUsed: string;
}

const CODE_FENCE = String.fromCharCode(96).repeat(3);

function readStoredSettings(): { apiKey?: string; model?: string; demoMode?: boolean } {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('adam_studio_settings');
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        apiKey: typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : undefined,
        model: typeof parsed?.defaultModel === 'string' ? parsed.defaultModel.trim() : undefined,
        demoMode: Boolean(parsed?.demoMode),
      };
    }
  } catch {
    // ignore storage errors
  }
  return {};
}

function summarizeWorkspace(files: WorkspaceCommitFile[]): string {
  const limited = files.slice(0, 35);
  const pathList = limited
    .map((f) => `- ${f.path} (${f.content.split(/\r?\n/).length} lines)`)
    .join('\n');

  const keySnippets = limited
    .filter((f) => !/lock\.json$|\.png$|\.jpg$|\.svg$/i.test(f.path))
    .slice(0, 6)
    .map((f) => {
      const preview = f.content.slice(0, 320).replace(/\s+/g, ' ').trim();
      return `[${f.path}]: ${preview}`;
    })
    .join('\n');

  const extra =
    files.length > limited.length ? `\n...dan ${files.length - limited.length} file lainnya` : '';
  return `Total file: ${files.length}\nDaftar file:\n${pathList}${extra}\n\nCuplikan konten:\n${keySnippets}`;
}

export function generateCommitLocally(
  files: WorkspaceCommitFile[],
  style: CommitMessageStyle,
  repoName?: string
): string {
  const count = files.length;
  const hasApi = files.some((f) => f.path.startsWith('api/') || f.path.includes('server/'));
  const hasUi = files.some((f) => f.path.includes('components/') || f.path.endsWith('.css'));
  const scope = hasApi && hasUi ? 'app' : hasApi ? 'api' : hasUi ? 'ui' : 'workspace';
  const subject = `feat(${scope}): update ${count} workspace file${count === 1 ? '' : 's'}${repoName ? ` for ${repoName}` : ''}`;

  if (style === 'short') {
    return subject.slice(0, 72);
  }

  const bullets = files
    .slice(0, 6)
    .map((f) => `- Update ${f.path} (${f.content.split(/\r?\n/).length} lines)`);
  if (files.length > 6) {
    bullets.push(`- Include ${files.length - 6} additional workspace files`);
  }

  return `${subject}\n\n${bullets.join('\n')}`;
}

function cleanCommitOutput(raw: string): string {
  let text = raw.trim();
  if (text.startsWith(CODE_FENCE) && text.endsWith(CODE_FENCE)) {
    const lines = text.split(/\r?\n/);
    if (lines.length >= 2) {
      text = lines.slice(1, -1).join('\n').trim();
    }
  }
  return text.replace(/^["']|["']$/g, '').trim();
}

export async function generateCommitWithModel(
  options: GenerateCommitOptions
): Promise<GenerateCommitResult> {
  const {
    files,
    repoName,
    branch,
    style,
    model,
    customContext,
    apiKey,
    demoMode,
    signal,
    onStream,
  } = options;

  const stored = readStoredSettings();
  const activeModel = (model || stored.model || 'gemini-3.8-flash').trim();
  const effectiveDemo = demoMode ?? Boolean(stored.demoMode);

  if (!files || files.length === 0) {
    return {
      message:
        style === 'short'
          ? 'chore: update workspace'
          : 'chore: update workspace\n\n- Sync workspace changes',
      usedFallback: true,
      modelUsed: activeModel,
    };
  }

  if (effectiveDemo) {
    const local = generateCommitLocally(files, style, repoName);
    onStream?.(local);
    return { message: local, usedFallback: true, modelUsed: activeModel };
  }

  const resolvedKey = (apiKey && apiKey.trim()) || stored.apiKey || '';
  const normalizedKeys = resolvedKey
    .split(/[\r\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  const styleGuide =
    style === 'short'
      ? [
          'Gaya: SINGKAT (Short Conventional Commit).',
          '- Keluarkan HANYA 1 baris subject Conventional Commit (mis. feat(ui): ... atau fix(api): ...).',
          '- Maksimal 72 karakter, padat, akurat, tanpa body dan tanpa bullet points.',
        ].join('\n')
      : [
          'Gaya: DETAIL (Detailed Conventional Commit).',
          '- Baris 1: Subject Conventional Commit maksimal 72 karakter.',
          '- Baris 2: Kosong.',
          '- Baris 3+: 3 sampai 6 bullet points (- ...) yang merangkum perubahan teknis per area/modul secara jelas.',
        ].join('\n');

  const systemInstruction = [
    'Kamu adalah Principal Software Engineer di Adam Studio.',
    'Tugasmu membuat Git commit message yang akurat berdasarkan daftar file dan cuplikan kode workspace.',
    styleGuide,
    'Aturan wajib:',
    '- Keluarkan HANYA commit message siap pakai tanpa kata pengantar, tanpa tanda kutip pembungkus, dan tanpa markdown code fence.',
  ].join('\n');

  const summary = summarizeWorkspace(files);
  const userPrompt = [
    repoName ? `Repository: ${repoName}` : '',
    branch ? `Branch: ${branch}` : '',
    customContext ? `Catatan tambahan user: ${customContext}` : '',
    '',
    summary,
  ]
    .filter(Boolean)
    .join('\n');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (normalizedKeys.length > 0) {
    headers['x-gemini-api-key'] = normalizedKeys.join(',');
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: activeModel,
        messages: [{ role: 'user', content: userPrompt }],
        builderMode: 'chat',
        systemInstruction,
        maxOutputTokens: style === 'short' ? 256 : 1024,
        includeThoughts: false,
        thinkingLevel: 'off',
        autoFallbackOnOverload: true,
        fallbackModel: 'gemini-3.8-flash',
        enableGoogleSearch: false,
        enableUrlContext: false,
        demoMode: false,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    const processBlock = (rawBlock: string) => {
      if (!rawBlock.trim() || rawBlock.startsWith(':')) return;

      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of rawBlock.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim().toLowerCase();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (dataLines.length === 0) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      } catch {
        return;
      }

      if (eventName === 'error') {
        throw new Error(
          typeof parsed.message === 'string' ? parsed.message : 'Gagal generate commit message'
        );
      }

      if (eventName === 'delta' && typeof parsed.text === 'string') {
        accumulated += parsed.text;
        onStream?.(cleanCommitOutput(accumulated));
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

    const finalMsg = cleanCommitOutput(accumulated);
    if (!finalMsg) {
      throw new Error('Model tidak mengembalikan commit message');
    }

    return {
      message: finalMsg,
      usedFallback: false,
      modelUsed: activeModel,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const local = generateCommitLocally(files, style, repoName);
    onStream?.(local);
    return {
      message: local,
      usedFallback: true,
      modelUsed: activeModel,
    };
  }
}
