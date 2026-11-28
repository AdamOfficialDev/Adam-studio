import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowDown, Check, CheckCircle2, ChevronRight, Clock, Cloud, Code2, Copy, Eraser, ExternalLink, Eye, FileCode2, FolderGit2, FolderTree, Laptop, Loader2, Maximize2, Minimize2, Play, Plus, RefreshCw, Rocket, RotateCcw, Search, Smartphone, Sparkles, Square, Tablet, Terminal, Trash2, WrapText, X, XCircle, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmergentPlanCard } from '@/components/EmergentPlanCard';
import {
  buildProjectZipBlob,
  compileWorkspaceToHtml,
  scaffoldRunnableProjectFiles,
} from '@/lib/workspace';
import { cn, copyToClipboard } from '@/lib/utils';
import type { GitHubProjectContext, VirtualWorkspace } from '@/types/chat';

import { GitHubPushDialog } from './GitHubPushDialog';
interface TerminalEntry {
  id: string;
  kind: 'system' | 'command' | 'success' | 'error' | 'info';
  command?: string;
  output: string;
  timestamp: number;
  durationMs?: number;
  exitCode?: number;
}

function stripAnsiCodes(input: string): string {
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function buildDaytonaPreviewUrl(url?: string, token?: string): string {
  if (!url) return '';
  if (!token) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('token') && !parsed.searchParams.has('previewToken')) {
      parsed.searchParams.set('token', token);
    }
    return parsed.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }
}

function isInfraOrAuthSandboxError(message: string): boolean {
  return /\b(DAYTONA_API_KEY|401|403|unauthorized|forbidden|failed to fetch|network error|abort|econnrefused|timeout|timed out|502 bad gateway|503|504|rate limit|quota)\b/i.test(
    message
  );
}

function formatClockTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

async function safeParseSandboxJson<T>(res: Response): Promise<T & { ok?: boolean; message?: string }> {
  const rawText = await res.text();
  if (!rawText) {
    return { ok: res.ok, message: res.ok ? undefined : `HTTP ${res.status}` } as T & {
      ok?: boolean;
      message?: string;
    };
  }
  try {
    return JSON.parse(rawText) as T & { ok?: boolean; message?: string };
  } catch {
    const preview = rawText.replace(/\s+/g, ' ').trim().slice(0, 220);
    return {
      ok: false,
      message: `Server mengembalikan respons non-JSON (HTTP ${res.status}): ${preview}`,
    } as T & { ok?: boolean; message?: string };
  }
}

function formatDurationMs(ms?: number): string {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function classifyTerminalLine(line: string): string {
  const lower = line.toLowerCase();
  if (
    /\b(err!|error|failed|fatal|exception|enoent|syntaxerror|typeerror|cannot find)\b/i.test(line) ||
    line.trim().startsWith('✗') ||
    line.trim().startsWith('×')
  ) {
    return 'text-rose-400';
  }
  if (/\b(warn|warning|deprecated)\b/i.test(line) || line.trim().startsWith('⚠')) {
    return 'text-amber-300';
  }
  if (
    /\b(ready in|built in|server_ready|added \d+ package|up to date|success|completed)\b/i.test(lower) ||
    line.trim().startsWith('✓') ||
    line.includes('Local:') ||
    line.includes('Network:')
  ) {
    return 'text-emerald-400';
  }
  if (/^\s*(at\s+|\||>\s*\d+\s*\|)/.test(line)) {
    return 'text-zinc-400';
  }
  return 'text-zinc-200';
}

function renderHighlightedText(text: string, query: string) {
  const q = query.trim();
  const urlRegex = /(https?:\/\/[^\s)'"`>]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, idx) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 underline decoration-sky-400/50 underline-offset-2 hover:text-sky-300"
        >
          {part}
        </a>
      );
    }
    if (!q) return <span key={idx}>{part}</span>;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const splitRegex = new RegExp(`(${escaped})`, 'gi');
    const subParts = part.split(splitRegex);
    return subParts.map((sub, subIdx) =>
      sub.toLowerCase() === q.toLowerCase() ? (
        <mark
          key={`${idx}-${subIdx}`}
          className="rounded bg-amber-400/30 px-0.5 text-amber-100"
        >
          {sub}
        </mark>
      ) : (
        <span key={`${idx}-${subIdx}`}>{sub}</span>
      )
    );
  });
}
const LazyCodeMirrorEditor = lazy(() => import('@/components/CodeMirrorEditor'));

const TERMINAL_ENTRIES_STORAGE_PREFIX = 'adam_emergent_terminal_entries_v2_';
const TERMINAL_HISTORY_STORAGE_PREFIX = 'adam_emergent_cmd_history_v2_';

const DEFAULT_TERMINAL_WELCOME: TerminalEntry = {
  id: 'init-welcome',
  kind: 'system',
  output: 'Daytona Cloud Terminal siap. Klik "Run in Daytona", pilih Quick Command, atau ketik perintah bash di bawah.',
  timestamp: Date.now(),
};

function loadPersistedTerminalEntries(scopeId: string): TerminalEntry[] {
  try {
    const raw = localStorage.getItem(TERMINAL_ENTRIES_STORAGE_PREFIX + scopeId);
    if (!raw) return [DEFAULT_TERMINAL_WELCOME];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(-80);
    }
  } catch {
    // Abaikan error parse storage
  }
  return [DEFAULT_TERMINAL_WELCOME];
}

function loadPersistedCmdHistory(scopeId: string): string[] {
  try {
    const raw = localStorage.getItem(TERMINAL_HISTORY_STORAGE_PREFIX + scopeId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

interface WorkspacePanelProps {
  isOpen?: boolean;
  workspace: VirtualWorkspace;
  githubProject?: GitHubProjectContext;
  githubToken?: string;
  daytonaApiKey?: string;
  daytonaApiUrl?: string;
  onUpdateSandbox?: (info: {
    sandboxId?: string;
    previewUrl?: string;
    previewToken?: string;
    vmFileTree?: string[];
    vmTotalFiles?: number;
  }) => void;
  onImportFiles?: (
    files: Array<{ path: string; content: string }>,
    sandboxInfo?: {
      sandboxId?: string;
      previewUrl?: string;
      previewToken?: string;
      vmFileTree?: string[];
      vmTotalFiles?: number;
    }
  ) => void;
  onOpenGitHubConnector?: () => void;
  onChangeActiveFile: (path: string) => void;
  onEditFile: (path: string, content: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onAutoFixError: (errorMsg: string) => void;
  onClose: () => void;
  activeModel?: string;
  geminiApiKey?: string;
  demoMode?: boolean;
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';
type WorkspaceTab = 'preview' | 'code' | 'terminal' | 'plan';
type PreviewEngine = 'browser' | 'daytona';

const DAYTONA_SANDBOX_STORAGE_PREFIX = 'adam_daytona_sandbox_v2_';

function readStoredSandboxId(scopeId: string): string | undefined {
  if (!scopeId) return undefined;
  try {
    const val = localStorage.getItem(DAYTONA_SANDBOX_STORAGE_PREFIX + scopeId)?.trim();
    return val || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredSandboxId(scopeId: string, id?: string) {
  if (!scopeId) return;
  try {
    if (id?.trim()) localStorage.setItem(DAYTONA_SANDBOX_STORAGE_PREFIX + scopeId, id.trim());
    else localStorage.removeItem(DAYTONA_SANDBOX_STORAGE_PREFIX + scopeId);
  } catch {
    // Abaikan error storage
  }
}

export const WorkspacePanel = memo(function WorkspacePanel({
  isOpen = true,
  workspace,
  githubProject,
  githubToken,
  daytonaApiKey,
  daytonaApiUrl,
  onUpdateSandbox,
  onImportFiles,
  onOpenGitHubConnector,
  onChangeActiveFile,
  onEditFile,
  onCreateFile,
  onDeleteFile,
  onAutoFixError,
  onClose, activeModel = 'gemini-3.8-flash', geminiApiKey, demoMode = false,
}: WorkspacePanelProps) {
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>('preview');

  const [cleaningSandboxes, setCleaningSandboxes] = useState(false);
  const fallbackScopeRef = useRef<string>('ws-' + Math.random().toString(36).slice(2, 8));
  const workspaceScopeId = useMemo(() => {
    if (workspace.projectId?.trim()) return workspace.projectId.trim();
    if (workspace.daytonaSandboxId?.trim()) return 'sb-' + workspace.daytonaSandboxId.trim();
    if (workspace.plan?.title?.trim()) {
      return 'plan-' + workspace.plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32);
    }
    return fallbackScopeRef.current;
  }, [workspace.projectId, workspace.daytonaSandboxId, workspace.plan?.title]);

  const effectiveSandboxId =
    workspace.daytonaSandboxId || (workspace.projectId ? readStoredSandboxId(workspaceScopeId) : undefined);

  useEffect(() => {
    if (workspace.daytonaSandboxId && workspaceScopeId) {
      writeStoredSandboxId(workspaceScopeId, workspace.daytonaSandboxId);
    }
  }, [workspace.daytonaSandboxId, workspaceScopeId]);
  const [engine, setEngine] = useState<PreviewEngine>(() =>
    workspace.daytonaPreviewUrl ? 'daytona' : 'browser'
  );
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelWidthPct, setPanelWidthPct] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [vmExplorerOpen, setVmExplorerOpen] = useState(false);
  const [vmSearchQuery, setVmSearchQuery] = useState('');
  const [loadingVmFilePath, setLoadingVmFilePath] = useState<string | null>(null);

  // Daytona state
  const [deployingDaytona, setDeployingDaytona] = useState(false);
  const [cloningRepo, setCloningRepo] = useState(false);
  const [runningCmd, setRunningCmd] = useState(false);
  const [runningCmdLabel, setRunningCmdLabel] = useState<string>('');
  const [cmdStartedAt, setCmdStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [terminalCmd, setTerminalCmd] = useState('');
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>(() =>
    loadPersistedTerminalEntries(workspaceScopeId)
  );
  const [cmdHistory, setCmdHistory] = useState<string[]>(() =>
    loadPersistedCmdHistory(workspaceScopeId)
  );
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [terminalSearch, setTerminalSearch] = useState('');
  const [showTerminalSearch, setShowTerminalSearch] = useState(false);
  const [terminalWrap, setTerminalWrap] = useState(true);
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const [copiedSandboxId, setCopiedSandboxId] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [terminalError, setTerminalError] = useState<{ command: string; output: string } | null>(null);
  const [autoHealEnabled, setAutoHealEnabled] = useState(false);
  const lastSyncedSnapshotRef = useRef<Map<string, string>>(new Map());
  const terminalViewportRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);

  const asideRef = useRef<HTMLElement>(null);

  const filePaths = useMemo(() => Object.keys(workspace.files).sort(), [workspace.files]);
  const vmAllPaths = useMemo(() => {
    const merged = new Set([...(workspace.vmFileTree || []), ...filePaths]);
    return Array.from(merged).sort();
  }, [workspace.vmFileTree, filePaths]);
  const filteredVmPaths = useMemo(() => {
    const q = vmSearchQuery.trim().toLowerCase();
    const list = q ? vmAllPaths.filter((p) => p.toLowerCase().includes(q)) : vmAllPaths;
    return list.slice(0, 120);
  }, [vmAllPaths, vmSearchQuery]);
  const activePath =
    workspace.activePath && workspace.files[workspace.activePath]
      ? workspace.activePath
      : filePaths[0] || '';
  const activeFile = activePath ? workspace.files[activePath] : null;

  const compiled = useMemo(() => compileWorkspaceToHtml(workspace), [workspace]);

  useEffect(() => {
    if (workspace.daytonaPreviewUrl) {
      setEngine('daytona');
    }
  }, [workspace.daytonaPreviewUrl]);

  useEffect(() => {
    setRuntimeError(null);
  }, [compiled.html, refreshNonce]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'adam-build-error' && typeof e.data.error === 'string') {
        setRuntimeError(e.data.error);
      } else if (e.data.type === 'adam-build-ok') {
        setRuntimeError(null);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!runningCmd && !deployingDaytona) {
      setCmdStartedAt(null);
      setElapsedMs(0);
      return;
    }
    const start = cmdStartedAt ?? Date.now();
    if (!cmdStartedAt) setCmdStartedAt(start);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => window.clearInterval(id);
  }, [runningCmd, deployingDaytona, cmdStartedAt]);

  useEffect(() => {
    lastSyncedSnapshotRef.current = new Map();
    setTerminalEntries(loadPersistedTerminalEntries(workspaceScopeId));
    setCmdHistory(loadPersistedCmdHistory(workspaceScopeId));
    setTerminalError(null);
  }, [workspaceScopeId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TERMINAL_ENTRIES_STORAGE_PREFIX + workspaceScopeId,
        JSON.stringify(terminalEntries.slice(-80))
      );
    } catch {
      // Abaikan quota error
    }
  }, [terminalEntries, workspaceScopeId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TERMINAL_HISTORY_STORAGE_PREFIX + workspaceScopeId,
        JSON.stringify(cmdHistory.slice(0, 40))
      );
    } catch {
      // Abaikan quota error
    }
  }, [cmdHistory, workspaceScopeId]);

  useEffect(() => {
    if (tab !== 'terminal') return;
    const el = terminalViewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowScrollBottomBtn(false);
  }, [terminalEntries, tab, runningCmd]);
  const sandboxHeaders = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (daytonaApiKey?.trim()) h['x-daytona-api-key'] = daytonaApiKey.trim();
    if (daytonaApiUrl?.trim()) h['x-daytona-api-url'] = daytonaApiUrl.trim();
    if (githubToken?.trim()) h['x-github-token'] = githubToken.trim();
    return h;
  };

  const appendLog = (
    text: string,
    meta?: {
      kind?: TerminalEntry['kind'];
      command?: string;
      durationMs?: number;
      exitCode?: number;
    }
  ) => {
    const cleaned = stripAnsiCodes(String(text || '')).trimEnd();
    if (!cleaned && !meta?.command) return;
    const now = Date.now();
    let inferredKind: TerminalEntry['kind'] = meta?.kind ?? 'info';
    let inferredCmd = meta?.command;
    if (!meta?.kind && cleaned.startsWith('$ ')) {
      inferredKind = 'info';
      inferredCmd = cleaned.slice(2).trim();
    } else if (!meta?.kind && /^error:/i.test(cleaned)) {
      inferredKind = 'error';
    }
    setTerminalEntries((prev) => {
      const next = [
        ...prev,
        {
          id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
          kind: inferredKind,
          command: inferredCmd,
          output: inferredCmd && !meta?.kind ? '' : cleaned,
          timestamp: now,
          durationMs: meta?.durationMs,
          exitCode: meta?.exitCode,
        },
      ];
      return next.length > 120 ? next.slice(-120) : next;
    });
  };

  const handleClearTerminal = () => {
    setTerminalEntries([
      {
        id: `clear-${Date.now()}`,
        kind: 'system',
        output: 'Terminal dibersihkan. Siap menerima perintah berikutnya.',
        timestamp: Date.now(),
      },
    ]);
    setTerminalError(null);
  };

  const handleCopyAllTerminal = async () => {
    const fullText = terminalEntries
      .map((e) => {
        const head = e.command ? `$ ${e.command}` : '';
        return [head, e.output].filter(Boolean).join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
    const ok = await copyToClipboard(fullText);
    if (ok) toast.success('Seluruh log terminal disalin');
    else toast.error('Gagal menyalin log terminal');
  };

  const handleCopyEntry = async (entry: TerminalEntry) => {
    const text = [entry.command ? `$ ${entry.command}` : '', entry.output].filter(Boolean).join('\n');
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedEntryId(entry.id);
      setTimeout(() => setCopiedEntryId((id) => (id === entry.id ? null : id)), 1500);
    }
  };

  const handleCopySandboxId = async () => {
    if (!workspace.daytonaSandboxId) return;
    const ok = await copyToClipboard(workspace.daytonaSandboxId);
    if (ok) {
      setCopiedSandboxId(true);
      toast.success('Sandbox ID disalin');
      setTimeout(() => setCopiedSandboxId(false), 1500);
    }
  };

  const triggerTerminalAutoFix = (commandLabel: string, errorOutput: string) => {
    if (isInfraOrAuthSandboxError(errorOutput)) {
      toast.warning('Error berasal dari jaringan/autentikasi Daytona — Auto-Fix kode dilewati.');
      return;
    }
    const cleanLog = errorOutput.trim().slice(-4500);
    toast.info('Mengirim error terminal ke Emergent Agent untuk Auto-Fix...');
    onAutoFixError(
      'Terminal / Build Daytona gagal saat menjalankan "' + commandLabel + '".\n' +
        'Analisis error di bawah, perbaiki file yang bermasalah (package.json, src/*, atau config) di workspace, lalu verifikasi / jalankan ulang di Daytona:\n\n' +
        '\x60\x60\x60\n' + cleanLog + '\n\x60\x60\x60'
    );
  };

  const handleOpenVmFile = async (targetPath: string) => {
    if (workspace.files[targetPath]) {
      onChangeActiveFile(targetPath);
      setTab('code');
      return;
    }
    if (!effectiveSandboxId) {
      toast.error('Daytona Sandbox belum aktif untuk membaca file on-demand.');
      return;
    }
    setLoadingVmFilePath(targetPath);
    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: sandboxHeaders(),
        body: JSON.stringify({
          action: 'read-file',
          sandboxId: effectiveSandboxId,
          path: targetPath,
        }),
      });
      const data = await safeParseSandboxJson<{
        ok?: boolean;
        path?: string;
        content?: string;
        error?: string;
        message?: string;
      }>(res);
      if (!res.ok || !data.ok || typeof data.content !== 'string') {
        toast.error(data.error || data.message || `Gagal membaca ${targetPath} dari Daytona VM`);
        return;
      }
      onImportFiles?.([{ path: targetPath, content: data.content }], {
        sandboxId: effectiveSandboxId,
      });
      onChangeActiveFile(targetPath);
      setTab('code');
      setVmExplorerOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membaca file dari Daytona VM');
    } finally {
      setLoadingVmFilePath(null);
    }
  };

  const handleDeployDaytona = async () => {
    if (filePaths.length === 0) {
      toast.error('Workspace masih kosong.');
      return;
    }
    setDeployingDaytona(true);
    setTerminalError(null);
    setEngine('daytona');
    appendLog('$ [Daytona] Menyiapkan VM, sync file, npm install, & start Vite...');
    try {
      const hasExistingPkg = Boolean(workspace.files['package.json']);
      const scaffolded = hasExistingPkg
        ? Object.values(workspace.files).map((f) => ({ path: f.path, content: f.content }))
        : scaffoldRunnableProjectFiles(workspace.files, workspace.plan?.title);
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: sandboxHeaders(),
        body: JSON.stringify({
          action: 'deploy-preview',
          sandboxId: effectiveSandboxId,
          projectId: workspaceScopeId,
          files: scaffolded,
          port: 5173,
        }),
      });
      const data = await safeParseSandboxJson<{
        ok?: boolean;
        sandboxId?: string;
        previewUrl?: string;
        previewToken?: string;
        installOutput?: string;
        devLogs?: string;
        output?: string;
        message?: string;
      }>(res);
      if (data.installOutput) appendLog(data.installOutput);
      if (data.devLogs) appendLog(data.devLogs);
      if (data.output) appendLog(data.output);

      if (data.sandboxId) {
        writeStoredSandboxId(workspaceScopeId, data.sandboxId);
        onUpdateSandbox?.({
          sandboxId: data.sandboxId,
          ...(data.previewUrl ? { previewUrl: data.previewUrl } : {}),
          ...(data.previewToken ? { previewToken: data.previewToken } : {}),
        });
      }
      if (!res.ok || !data.ok) {
        const errLog = [data.message, data.output, data.installOutput, data.devLogs]
          .filter(Boolean)
          .join('\n');
        setTerminalError({ command: 'Run in Daytona (npm install & Vite)', output: errLog });
        toast.error(data.message || 'Gagal menjalankan proyek di Daytona');
        if (data.sandboxId) onUpdateSandbox?.({ sandboxId: data.sandboxId });
        if (autoHealEnabled && !isInfraOrAuthSandboxError(errLog)) {
          triggerTerminalAutoFix('Run in Daytona (npm install & Vite)', errLog);
        } else {
          setTab('terminal');
        }
        return;
      }

      const syncedMap = new Map<string, string>();
      for (const f of scaffolded) syncedMap.set(f.path, f.content);
      lastSyncedSnapshotRef.current = syncedMap;
      onUpdateSandbox?.({
        sandboxId: data.sandboxId,
        previewUrl: data.previewUrl,
        previewToken: data.previewToken,
      });
      setRefreshNonce((n) => n + 1);
      toast.success('Daytona Live Server aktif!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi /api/sandbox';
      appendLog('Error: ' + msg);
      toast.error(msg);
    } finally {
      setDeployingDaytona(false);
    }
  };

  const handleCloneRepoToDaytona = async (autoStart = true) => {
    if (!githubProject) {
      onOpenGitHubConnector?.();
      return;
    }
    setCloningRepo(true);
    setTerminalError(null);
    if (autoStart) setEngine('daytona');
    appendLog(
      `$ [Daytona] git clone ${githubProject.owner}/${githubProject.repo} (branch ${githubProject.branch})...`
    );
    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: sandboxHeaders(),
        body: JSON.stringify({
          action: 'clone-github',
          sandboxId: effectiveSandboxId,
          projectId: workspaceScopeId,
          owner: githubProject.owner,
          repo: githubProject.repo,
          branch: githubProject.branch,
          autoStart,
          port: 5173,
          maxWorkspaceFiles: 40,
        }),
      });
      const data = await safeParseSandboxJson<{
        ok?: boolean;
        sandboxId?: string;
        previewUrl?: string;
        previewToken?: string;
        files?: Array<{ path: string; content: string }>;
        totalFiles?: number;
        allPaths?: string[];
        skippedFiles?: string[];
        cloneOutput?: string;
        installOutput?: string;
        devLogs?: string;
        output?: string;
        message?: string;
      }>(res);
      if (data.cloneOutput) appendLog(data.cloneOutput);
      if (Array.isArray(data.skippedFiles) && data.skippedFiles.length > 0) {
        appendLog(`[Info] ${data.skippedFiles.length} file dilewati ke Editor (tetap ada di Daytona VM): ${data.skippedFiles.slice(0, 8).join(', ')}`);
      }
      if (data.installOutput) appendLog(data.installOutput);
      if (data.devLogs) appendLog(data.devLogs);
      if (data.output) appendLog(data.output);

      if (Array.isArray(data.files) && data.files.length > 0) {
        const syncedMap = new Map<string, string>();
        for (const f of data.files) syncedMap.set(f.path, f.content);
        lastSyncedSnapshotRef.current = syncedMap;
        onImportFiles?.(data.files, {
          sandboxId: data.sandboxId,
          previewUrl: data.previewUrl,
          previewToken: data.previewToken,
          vmFileTree: Array.isArray(data.allPaths) ? data.allPaths : undefined,
          vmTotalFiles: typeof data.totalFiles === 'number' ? data.totalFiles : undefined,
        });
      } else if (data.sandboxId) {
        onUpdateSandbox?.({
          sandboxId: data.sandboxId,
          previewUrl: data.previewUrl,
          previewToken: data.previewToken,
        });
      }

      if (!res.ok || !data.ok) {
        const errLog = [data.message, data.output, data.cloneOutput, data.installOutput, data.devLogs]
          .filter(Boolean)
          .join('\n');
        setTerminalError({
          command: `git clone & run ${githubProject.owner}/${githubProject.repo}`,
          output: errLog,
        });
        toast.error(data.message || 'Gagal clone / menjalankan repo di Daytona');
        if (autoHealEnabled && errLog && !isInfraOrAuthSandboxError(errLog)) {
          triggerTerminalAutoFix(`git clone & run ${githubProject.owner}/${githubProject.repo}`, errLog);
        } else {
          setTab('terminal');
        }
        return;
      }

      setRefreshNonce((n) => n + 1);
      toast.success(
        `${githubProject.owner}/${githubProject.repo} siap (${data.totalFiles || data.files?.length || 0} total file di VM, ${data.files?.length || 0} file dimuat ke editor)!`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal clone repo ke Daytona';
      appendLog('Error: ' + msg);
      toast.error(msg);
    } finally {
      setCloningRepo(false);
    }
  };
  const handleExecCommand = async (cmdToRun?: string) => {
    const cmd = (cmdToRun ?? terminalCmd).trim();
    if (!cmd || runningCmd) return;
    if (!cmdToRun) setTerminalCmd('');
    setCmdHistory((prev) => (prev[0] === cmd ? prev : [cmd, ...prev].slice(0, 40)));
    setHistoryIdx(-1);

    if (cmd === 'clear' || cmd === 'cls') {
      handleClearTerminal();
      return;
    }

    setRunningCmd(true);
    setRunningCmdLabel(cmd);
    setCmdStartedAt(Date.now());
    setTerminalError(null);
    const startedAt = performance.now();

    const dirtyFiles: Array<{ path: string; content: string }> = [];
    const prevSnap = lastSyncedSnapshotRef.current;
    for (const f of Object.values(workspace.files)) {
      if (prevSnap.get(f.path) !== f.content) {
        dirtyFiles.push({ path: f.path, content: f.content });
      }
    }

    const liveEntryId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setTerminalEntries((prev) => [
      ...prev.slice(-119),
      {
        id: liveEntryId,
        kind: 'info',
        command: cmd,
        output: dirtyFiles.length > 0 ? `[sync ${dirtyFiles.length} file ke VM...]\n` : '',
        timestamp: Date.now(),
      },
    ]);

    const updateLiveEntry = (patch: Partial<TerminalEntry>, appendText?: string) => {
      setTerminalEntries((prev) =>
        prev.map((item) => {
          if (item.id !== liveEntryId) return item;
          const nextOutput = appendText
            ? stripAnsiCodes(item.output + appendText)
            : patch.output !== undefined
              ? stripAnsiCodes(patch.output)
              : item.output;
          return { ...item, ...patch, output: nextOutput };
        })
      );
    };

    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: sandboxHeaders(),
        body: JSON.stringify({
          action: 'exec-stream',
          sandboxId: effectiveSandboxId,
          projectId: workspace.projectId,
          command: cmd,
          files: dirtyFiles.length > 0 ? dirtyFiles : undefined,
          knownPaths: filePaths,
          syncBack: true,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      let finalData: {
        ok?: boolean;
        sandboxId?: string;
        exitCode?: number;
        output?: string;
        previewUrl?: string;
        previewToken?: string;
        syncedFiles?: Array<{ path: string; content: string }>;
        deletedPaths?: string[];
        message?: string;
      } = {};

      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamedText = '';

        const handleSseBlock = (rawBlock: string) => {
          if (!rawBlock.trim() || rawBlock.startsWith(':')) return;
          let evName = 'message';
          const lines: string[] = [];
          for (const line of rawBlock.split('\n')) {
            if (line.startsWith('event:')) evName = line.slice(6).trim();
            else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
          }
          if (lines.length === 0) return;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(lines.join('\n'));
          } catch {
            return;
          }
          if (evName === 'status' && typeof parsed.message === 'string') {
            updateLiveEntry({ output: (streamedText ? streamedText + '\n' : '') + `[${parsed.message}]\n` });
          } else if (evName === 'chunk' && typeof parsed.text === 'string') {
            streamedText += parsed.text;
            updateLiveEntry({ output: streamedText });
          } else if (evName === 'done') {
            finalData = parsed as typeof finalData;
          } else if (evName === 'error') {
            finalData = {
              ok: false,
              exitCode: 1,
              message: typeof parsed.message === 'string' ? parsed.message : 'Daytona stream error',
              output: streamedText || (typeof parsed.message === 'string' ? parsed.message : ''),
            };
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split('\n\n');
          buf = blocks.pop() ?? '';
          for (const b of blocks) handleSseBlock(b);
        }
        if (buf.trim()) handleSseBlock(buf);
        if (!finalData.output && streamedText) finalData.output = streamedText;
      } else {
        finalData = await safeParseSandboxJson<typeof finalData>(res);
      }

      const durationMs = performance.now() - startedAt;
      if (dirtyFiles.length > 0 && res.ok) {
        const nextSnap = new Map(lastSyncedSnapshotRef.current);
        for (const f of dirtyFiles) nextSnap.set(f.path, f.content);
        lastSyncedSnapshotRef.current = nextSnap;
      }

      if (finalData.previewUrl || (finalData.sandboxId && finalData.sandboxId !== workspace.daytonaSandboxId)) {
        onUpdateSandbox?.({
          sandboxId: finalData.sandboxId ?? workspace.daytonaSandboxId,
          ...(finalData.previewUrl ? { previewUrl: finalData.previewUrl } : {}),
          ...(finalData.previewToken ? { previewToken: finalData.previewToken } : {}),
        });
        if (finalData.previewUrl) setRefreshNonce((n) => n + 1);
      }

      if (Array.isArray(finalData.syncedFiles) && finalData.syncedFiles.length > 0) {
        const changedFromVm = finalData.syncedFiles.filter(
          (f) => workspace.files[f.path]?.content !== f.content
        );
        if (changedFromVm.length > 0) {
          onImportFiles?.(changedFromVm, {
            sandboxId: finalData.sandboxId ?? workspace.daytonaSandboxId,
          });
        }
        const nextSnap = new Map<string, string>();
        for (const f of finalData.syncedFiles) nextSnap.set(f.path, f.content);
        lastSyncedSnapshotRef.current = nextSnap;
      }

      if (Array.isArray(finalData.deletedPaths) && finalData.deletedPaths.length > 0) {
        for (const delPath of finalData.deletedPaths) {
          if (workspace.files[delPath]) onDeleteFile(delPath);
        }
      }

      const exitCode =
        typeof finalData.exitCode === 'number'
          ? finalData.exitCode
          : res.ok && finalData.ok
            ? 0
            : 1;
      const outText = (finalData.output || finalData.message || `(selesai dengan exit ${exitCode})`).trimEnd();
      const isOk = Boolean(res.ok && finalData.ok);
      updateLiveEntry({
        kind: isOk ? 'success' : 'error',
        output: outText,
        durationMs,
        exitCode,
      });

      if (!isOk) {
        const errOut = finalData.output || finalData.message || `Exit code ${exitCode}`;
        setTerminalError({ command: cmd, output: errOut });
        toast.error(finalData.message || `Perintah gagal (exit ${exitCode})`);
        if (
          autoHealEnabled &&
          !isInfraOrAuthSandboxError(errOut) &&
          (cmd.includes('npm') || cmd.includes('tsc') || cmd.includes('vite') || cmd.includes('build'))
        ) {
          triggerTerminalAutoFix(cmd, errOut);
        }
      }
    } catch (err) {
      const durationMs = performance.now() - startedAt;
      const msg = err instanceof Error ? err.message : 'Network error';
      updateLiveEntry({
        kind: 'error',
        output: `Error: ${msg}`,
        durationMs,
        exitCode: 1,
      });
    } finally {
      setRunningCmd(false);
      setRunningCmdLabel('');
    }
  };
  const handleCleanupExtraSandboxes = async () => {
    if (cleaningSandboxes) return;
    setCleaningSandboxes(true);
    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: sandboxHeaders(),
        body: JSON.stringify({
          action: 'cleanup-sandboxes',
          sandboxId: effectiveSandboxId,
          projectId: workspaceScopeId,
        }),
      });
      const data = await safeParseSandboxJson<{
        deleted?: number;
        totalFound?: number;
        keptSandboxId?: string;
      }>(res);
      if (data.keptSandboxId) {
        writeStoredSandboxId(workspaceScopeId, data.keptSandboxId);
        onUpdateSandbox?.({ sandboxId: data.keptSandboxId });
      }
      toast.success(
        `Selesai: ${data.deleted ?? 0} sandbox sisa dihapus (1 VM aktif dipertahankan).`
      );
    } catch {
      toast.error('Gagal membersihkan sandbox sisa di Daytona');
    } finally {
      setCleaningSandboxes(false);
    }
  };

  const handleStopSandbox = async () => {
    if (!workspace.daytonaSandboxId) return;
    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: sandboxHeaders(),
        body: JSON.stringify({ action: 'stop', sandboxId: effectiveSandboxId }),
      });
      if (res.ok) {
        toast.success('Daytona VM dihentikan (hemat kredit)');
        onUpdateSandbox?.({ sandboxId: effectiveSandboxId, previewUrl: undefined });
        setEngine('browser');
      }
    } catch {
      toast.error('Gagal menghentikan Daytona VM');
    }
  };

  const handlePointerResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizing(true);
    const onMove = (ev: PointerEvent) => {
      const vw = window.innerWidth;
      if (vw < 768) return;
      const pct = Math.min(72, Math.max(34, ((vw - ev.clientX) / vw) * 100));
      setPanelWidthPct(Math.round(pct));
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleDownloadZip = () => {
    if (filePaths.length === 0) return;
    const blob = buildProjectZipBlob(workspace.files, workspace.plan?.title);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (workspace.plan?.title || 'emergent-app')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    a.href = url;
    a.download = (slug || 'emergent-app') + '.zip';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Full Vite React Project (.zip) diunduh — siap npm install & npm run dev');
  };

  const handleCopyActiveFile = async () => {
    if (!activeFile) return;
    const ok = await copyToClipboard(activeFile.content);
    if (ok) {
      setCopied(true);
      toast.success(activeFile.path + ' disalin');
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error('Gagal menyalin kode file');
    }
  };

  const handleCommitNewFile = () => {
    const trimmed = newFileName.trim();
    if (!trimmed) return;
    onCreateFile(trimmed);
    setNewFileName('');
    setCreatingFile(false);
    setTab('code');
  };

  const viewportWidthClass =
    viewport === 'mobile'
      ? 'w-[375px] max-w-full'
      : viewport === 'tablet'
        ? 'w-[768px] max-w-full'
        : 'w-full';

  return (
    <aside
      ref={asideRef}
      aria-hidden={!isOpen}
      style={{
        ...(!isFullscreen ? { ['--ws-w' as string]: panelWidthPct + '%' } : {}),
        ...(isOpen ? {} : { display: 'none' }),
      }}
      className={cn(
        'fixed inset-0 z-40 flex h-full min-w-0 flex-col border-l border-border/80 bg-card',
        !isFullscreen && 'md:static md:z-auto md:w-[var(--ws-w)] md:shrink-0',
        isResizing && 'select-none'
      )}
    >
      {!isFullscreen && (
        <div
          onPointerDown={handlePointerResizeStart}
          title="Seret untuk memperbesar / memperkecil panel"
          className="absolute bottom-0 left-0 top-0 z-20 hidden w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 md:block"
        />
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-card/95 px-3.5 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Rocket className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold sm:text-sm">
                {workspace.plan?.title || 'Emergent Workspace'}
              </span>
              <span className="shrink-0 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                {filePaths.length} file
              </span>
            </div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {engine === 'daytona' ? 'Daytona Cloud VM' : compiled.mode === 'react-tsx' ? 'React + TSX + Tailwind' : 'HTML / CSS / JS'}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="inline-flex rounded-xl border border-border/75 bg-background/70 p-0.5">
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5',
                tab === 'preview'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('code')}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5',
                tab === 'code'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Code2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Files</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('terminal')}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5',
                tab === 'terminal'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Terminal</span>
              {(runningCmd || deployingDaytona) ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              ) : terminalError ? (
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setTab('plan')}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5',
                tab === 'plan'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Rocket className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Plan</span>
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadZip}
            disabled={filePaths.length === 0}
            title="Download Full Vite Project (.zip)"
            className="h-8 gap-1 rounded-xl px-2 text-[11px]"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden lg:inline">.zip</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPushDialogOpen(true)}
            disabled={!workspace || Object.keys(workspace.files || {}).length === 0}
            className="h-7 gap-1.5 rounded-lg border-primary/35 bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/20"
            title="Commit & Push workspace langsung ke GitHub"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Push</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? 'Keluar Fullscreen' : 'Fullscreen'}
            className="hidden h-8 w-8 rounded-xl md:inline-flex"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Tutup Workspace"
            className="h-8 w-8 rounded-xl"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {vmAllPaths.length > filePaths.length && (
        <div className="shrink-0 border-b border-border/70 bg-emerald-950/20 px-3.5 py-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex min-w-0 items-center gap-1.5 text-emerald-300">
              <FolderTree className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-medium">
                Mode Proyek Besar: {workspace.vmTotalFiles || vmAllPaths.length} file di VM ({filePaths.length} dimuat di editor)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setVmExplorerOpen((v) => !v)}
              className="shrink-0 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/25"
            >
              {vmExplorerOpen ? 'Tutup Index VM' : 'Cari / Buka File VM'}
            </button>
          </div>

          {vmExplorerOpen && (
            <div className="mt-2 space-y-1.5 pb-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={vmSearchQuery}
                  onChange={(e) => setVmSearchQuery(e.target.value)}
                  placeholder={`Cari dari ${vmAllPaths.length} file di Daytona VM (misal: routes/api.ts)...`}
                  className="h-7 pl-8 text-xs"
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border/70 bg-background/90 p-1">
                {filteredVmPaths.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                    Tidak ada file yang cocok dengan "{vmSearchQuery}".
                  </div>
                ) : (
                  filteredVmPaths.map((p) => {
                    const isLoaded = Boolean(workspace.files[p]);
                    const isLoading = loadingVmFilePath === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={Boolean(loadingVmFilePath)}
                        onClick={() => void handleOpenVmFile(p)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-mono text-[11px] hover:bg-muted/70"
                      >
                        <span className="truncate text-foreground">{p}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {isLoading ? 'loading...' : isLoaded ? 'loaded' : 'VM lazy'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'preview' && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/50 px-3.5 py-1.5">
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-border/70 bg-card/80 p-0.5 text-[10px] font-medium">
              <button
                type="button"
                onClick={() => setEngine('browser')}
                className={cn(
                  'rounded-md px-2 py-0.5 transition-colors',
                  engine === 'browser'
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Browser
              </button>
              <button
                type="button"
                onClick={() => setEngine('daytona')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors',
                  engine === 'daytona'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Cloud className="h-3 w-3" />
                Daytona
              </button>
            </div>

            <div className="hidden items-center gap-0.5 sm:flex">
              {(
                [
                  ['desktop', Laptop],
                  ['tablet', Tablet],
                  ['mobile', Smartphone],
                ] as const
              ).map(([key, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setViewport(key)}
                  className={cn(
                    'rounded-lg p-1.5 transition-colors',
                    viewport === key
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  title={key}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>

            {!isFullscreen && (
              <div className="hidden items-center gap-1 border-l border-border/60 pl-2 font-mono text-[10px] text-muted-foreground lg:flex">
                <button
                  type="button"
                  onClick={() => setPanelWidthPct(38)}
                  className={cn(
                    'rounded px-1.5 py-0.5 hover:bg-muted',
                    panelWidthPct <= 42 && 'bg-primary/15 text-primary'
                  )}
                >
                  Kecil
                </button>
                <button
                  type="button"
                  onClick={() => setPanelWidthPct(50)}
                  className={cn(
                    'rounded px-1.5 py-0.5 hover:bg-muted',
                    panelWidthPct > 42 && panelWidthPct < 58 && 'bg-primary/15 text-primary'
                  )}
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={() => setPanelWidthPct(66)}
                  className={cn(
                    'rounded px-1.5 py-0.5 hover:bg-muted',
                    panelWidthPct >= 58 && 'bg-primary/15 text-primary'
                  )}
                >
                  Lebar
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {githubProject ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cloningRepo || deployingDaytona}
                onClick={() => void handleCloneRepoToDaytona(engine === 'daytona')}
                className="h-7 gap-1 rounded-lg border-emerald-500/35 bg-emerald-500/10 px-2 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                title={`Clone ${githubProject.owner}/${githubProject.repo} ke Daytona & Workspace`}
              >
                {cloningRepo ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FolderGit2 className="h-3 w-3" />
                )}
                <span className="hidden sm:inline">Clone Repo</span>
              </Button>
            ) : onOpenGitHubConnector ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenGitHubConnector}
                className="h-7 gap-1 rounded-lg px-2 text-[11px]"
                title="Import repository GitHub ke Emergent Workspace"
              >
                <FolderGit2 className="h-3 w-3" />
                <span className="hidden sm:inline">Import GitHub</span>
              </Button>
            ) : null}
            {engine === 'daytona' && (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={deployingDaytona || filePaths.length === 0}
                  onClick={() => void handleDeployDaytona()}
                  className="h-7 gap-1 rounded-lg px-2.5 text-[11px]"
                >
                  {deployingDaytona ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  <span>{workspace.daytonaPreviewUrl ? 'Sync & Restart' : 'Run in Daytona'}</span>
                </Button>
                {workspace.daytonaPreviewUrl && (
                  <a
                    href={buildDaytonaPreviewUrl(workspace.daytonaPreviewUrl, workspace.daytonaPreviewToken)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/75 bg-card px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    title="Buka URL Preview Daytona di Tab Baru"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </>
            )}

            {runtimeError && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => onAutoFixError(runtimeError)}
                className="h-7 gap-1 rounded-lg px-2.5 text-[11px]"
              >
                <Sparkles className="h-3 w-3" />
                <span>Auto-Fix AI</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRefreshNonce((n) => n + 1)}
              className="h-7 gap-1 rounded-lg px-2 text-[11px] text-muted-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              <span className="hidden sm:inline">Reload</span>
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden bg-background/60">
        {tab === 'preview' && (
          <div className="flex h-full w-full flex-col items-center overflow-hidden p-2 sm:p-3">
            {runtimeError && engine === 'browser' && (
              <div className="mb-2 flex w-full items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <div className="flex min-w-0 items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="truncate font-mono text-[11px]">{runtimeError}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => onAutoFixError(runtimeError)}
                  className="h-7 shrink-0 gap-1 rounded-lg px-2.5 text-[11px]"
                >
                  <Sparkles className="h-3 w-3" />
                  Fix dengan Emergent
                </Button>
              </div>
            )}

            {engine === 'daytona' ? (
              <div
                className={cn(
                  'relative min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-border/80 bg-zinc-950 shadow-lg transition-[width] duration-200',
                  viewportWidthClass
                )}
              >
                {deployingDaytona ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    <div className="text-sm font-semibold">Menjalankan di Daytona Cloud Sandbox...</div>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      Menyiapkan container Linux, menyinkronkan {filePaths.length} file, menjalankan{' '}
                      <code className="font-mono">npm install</code>, dan menyalakan Vite server.
                    </p>
                  </div>
                ) : workspace.daytonaPreviewUrl ? (
                  <iframe
                    key={workspace.daytonaPreviewUrl + '-' + (workspace.daytonaPreviewToken || '') + '-' + refreshNonce}
                    title="Daytona Live Preview"
                    src={buildDaytonaPreviewUrl(workspace.daytonaPreviewUrl, workspace.daytonaPreviewToken)}
                    className={cn('h-full w-full border-0 bg-zinc-950', isResizing && 'pointer-events-none')}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                      <Cloud className="h-6 w-6" />
                    </div>
                    <div className="text-sm font-semibold">Daytona Cloud Sandbox Siap</div>
                    <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                      Jalankan proyek dengan <code className="font-mono">npm install</code> & Vite dev
                      server nyata di Linux VM Daytona (cocok untuk library npm apa pun).
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={filePaths.length === 0 || deployingDaytona}
                        onClick={() => void handleDeployDaytona()}
                        className="gap-1.5 rounded-xl px-4"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>Run in Daytona</span>
                      </Button>
                      {githubProject && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={cloningRepo}
                          onClick={() => void handleCloneRepoToDaytona(true)}
                          className="gap-1.5 rounded-xl border-emerald-500/35 bg-emerald-500/10 px-4 text-emerald-300 hover:bg-emerald-500/20"
                        >
                          {cloningRepo ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FolderGit2 className="h-3.5 w-3.5" />
                          )}
                          <span>Git Clone & Run Repo</span>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                className={cn(
                  'min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-border/80 bg-zinc-950 shadow-lg transition-[width] duration-200',
                  viewportWidthClass
                )}
              >
                <iframe
                  key={'browser-' + refreshNonce}
                  title="Emergent Live Preview"
                  srcDoc={compiled.html}
                  sandbox="allow-scripts allow-modals allow-forms"
                  className={cn('h-full w-full border-0 bg-zinc-950', isResizing && 'pointer-events-none')}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'code' && (
          <div className="flex h-full min-w-0 flex-col sm:flex-row">
            <div className="flex max-h-44 shrink-0 flex-col border-b border-border/75 bg-card/70 sm:max-h-none sm:w-44 lg:w-52 sm:border-b-0 sm:border-r">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <FolderTree className="h-3.5 w-3.5 text-primary" />
                  Project Files
                </span>
                <button
                  type="button"
                  onClick={() => setCreatingFile((c) => !c)}
                  className="rounded-md p-1 hover:bg-muted hover:text-foreground"
                  title="File Baru"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {creatingFile && (
                <div className="flex items-center gap-1 border-b border-border/60 p-1.5">
                  <Input
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCommitNewFile();
                      if (e.key === 'Escape') setCreatingFile(false);
                    }}
                    placeholder="src/Card.tsx"
                    className="h-7 rounded-lg px-2 font-mono text-[11px]"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="icon"
                    onClick={handleCommitNewFile}
                    className="h-7 w-7 shrink-0 rounded-lg"
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                </div>
              )}

              <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
                {filePaths.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-muted-foreground">
                    Belum ada file. Kirim prompt di mode Emergent untuk mulai membangun.
                  </p>
                ) : (
                  filePaths.map((p) => {
                    const isActive = p === activePath;
                    return (
                      <div
                        key={p}
                        className={cn(
                          'group flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors',
                          isActive
                            ? 'bg-primary/15 font-medium text-primary'
                            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onChangeActiveFile(p)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-mono text-[11px]">{p}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteFile(p)}
                          className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:inline-flex"
                          title="Hapus file"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {activeFile ? (
                <>
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-card/70 px-3 py-1.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 truncate font-mono text-[11px] font-medium text-foreground">
                        {activeFile.path}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCopyActiveFile()}
                      className="h-7 shrink-0 gap-1.5 rounded-lg border border-border/70 px-2.5 text-[11px]"
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>{copied ? 'Disalin' : 'Copy'}</span>
                    </Button>
                  </div>
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span>Memuat editor...</span>
                        </div>
                      }
                    >
                      <LazyCodeMirrorEditor
                        value={activeFile.content}
                        language={activeFile.language}
                        onChange={(val) => onEditFile(activeFile.path, val)}
                      />
                    </Suspense>
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
                  Pilih file dari daftar untuk melihat atau mengedit kode.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'terminal' && (
          <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
            {/* Top Status & Controls Header */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                    runningCmd || deployingDaytona
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      : workspace.daytonaSandboxId
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                        : 'border-border/70 bg-muted/60 text-muted-foreground'
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      runningCmd || deployingDaytona
                        ? 'animate-ping bg-amber-400'
                        : workspace.daytonaSandboxId
                          ? 'bg-emerald-400'
                          : 'bg-zinc-500'
                    )}
                  />
                  <span>
                    {runningCmd || deployingDaytona
                      ? `RUNNING ${formatDurationMs(elapsedMs)}`
                      : workspace.daytonaSandboxId
                        ? 'DAYTONA LIVE'
                        : 'STANDBY'}
                  </span>
                </div>

                {workspace.daytonaSandboxId && (
                  <button
                    type="button"
                    onClick={() => void handleCopySandboxId()}
                    title="Salin Sandbox ID"
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Cloud className="h-3 w-3 text-emerald-400" />
                    <span>{workspace.daytonaSandboxId.slice(0, 10)}</span>
                    {copiedSandboxId ? (
                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-2.5 w-2.5 opacity-70" />
                    )}
                  </button>
                )}
                {githubProject && (
                  <span className="hidden items-center gap-1 rounded-md border border-border/60 bg-background/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline-flex">
                    {githubProject.owner}/{githubProject.repo}@{githubProject.branch}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setAutoHealEnabled((v) => !v)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[10px] font-semibold transition-colors',
                    autoHealEnabled
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border/70 bg-background/60 text-muted-foreground hover:text-foreground'
                  )}
                  title="Otomatis kirim error npm/build ke Emergent Agent untuk diperbaiki"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Auto-Heal {autoHealEnabled ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowTerminalSearch((s) => !s);
                    if (showTerminalSearch) setTerminalSearch('');
                  }}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors',
                    showTerminalSearch
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border/70 bg-background/60 text-muted-foreground hover:text-foreground'
                  )}
                  title="Cari / Filter Log"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setTerminalWrap((w) => !w)}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors',
                    terminalWrap
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border/70 bg-background/60 text-muted-foreground hover:text-foreground'
                  )}
                  title={terminalWrap ? 'Line Wrap: ON' : 'Line Wrap: OFF'}
                >
                  <WrapText className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyAllTerminal()}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
                  title="Salin Semua Log"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={handleClearTerminal}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
                  title="Bersihkan Terminal (Ctrl+L)"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </button>

                {workspace.daytonaSandboxId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleStopSandbox()}
                    className="h-7 gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-2 text-[10px] text-destructive hover:bg-destructive/20"
                    title="Hentikan Daytona VM untuk menghemat kredit"
                  >
                    <Square className="h-3 w-3" />
                    <span className="hidden sm:inline">Stop VM</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={cleaningSandboxes}
                  onClick={() => void handleCleanupExtraSandboxes()}
                  className="h-7 gap-1 rounded-lg border border-border/70 bg-background/60 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                  title="Hapus sandbox lama yang menumpuk di Daytona (sisakan 1 VM aktif)"
                >
                  {cleaningSandboxes ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  <span className="hidden sm:inline">Bersihkan VM Sisa</span>
                </Button>
              </div>
            </div>

            {/* Quick Commands Bar */}
            <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 bg-card/50 px-3 py-1.5">
              <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                Quick
              </span>
              {(
                [
                ['npm install', 'npm install'],
                ['npm run build', 'npm run build'],
                ['tsc --noEmit', 'npx tsc --noEmit'],
                ['git status', 'git status -sb'],
                ['git pull', 'git pull'],
                ['ls -la', 'ls -la'],
                ['dev logs', 'tail -n 40 /tmp/adam-dev.log'],
                ['node -v', 'node -v && npm -v'],
                ] as const
              ).map(([label, cmd]) => (
                <button
                  key={label}
                  type="button"
                  disabled={runningCmd}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      setTerminalCmd(cmd);
                      terminalInputRef.current?.focus();
                    } else {
                      void handleExecCommand(cmd);
                    }
                  }}
                  title={`Klik untuk jalankan "${cmd}" • Shift+Klik untuk edit`}
                  className="shrink-0 rounded-md border border-border/70 bg-background/70 px-2 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Search Filter Input */}
            {showTerminalSearch && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-card/70 px-3 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={terminalSearch}
                  onChange={(e) => setTerminalSearch(e.target.value)}
                  placeholder="Filter atau cari kata di log terminal..."
                  className="h-7 flex-1 rounded-lg bg-background/80 font-mono text-[11px]"
                  autoFocus
                />
                {terminalSearch && (
                  <button
                    type="button"
                    onClick={() => setTerminalSearch('')}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            {/* Error Auto-Fix Banner */}
            {terminalError && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rose-500/35 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span className="truncate font-mono text-[11px]">
                    Gagal: {terminalError.command}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    triggerTerminalAutoFix(terminalError.command, terminalError.output)
                  }
                  className="h-7 shrink-0 gap-1 rounded-lg px-2.5 text-[11px]"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Auto-Fix dengan Emergent</span>
                </Button>
              </div>
            )}

            {/* Structured Terminal Stream */}
            <div className="relative min-h-0 flex-1">
              <div
                ref={terminalViewportRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                  setShowScrollBottomBtn(distanceFromBottom > 90);
                }}
                className="h-full space-y-2.5 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed"
              >
                {terminalEntries
                  .filter((entry) => {
                    const q = terminalSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      (entry.command || '').toLowerCase().includes(q) ||
                      entry.output.toLowerCase().includes(q)
                    );
                  })
                  .map((entry) => {
                    const isError = entry.kind === 'error' || (typeof entry.exitCode === 'number' && entry.exitCode !== 0);
                    const isSuccess = entry.kind === 'success' && (entry.exitCode === undefined || entry.exitCode === 0);
                    const lines = entry.output ? entry.output.split('\n') : [];
                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          'group rounded-xl border transition-colors',
                          isError
                            ? 'border-rose-500/30 bg-rose-950/20'
                            : entry.command
                              ? 'border-zinc-800/90 bg-zinc-900/55 hover:border-zinc-700/80'
                              : 'border-zinc-800/50 bg-zinc-900/25'
                        )}
                      >
                        {entry.command && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-1.5">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              {isError ? (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                              ) : isSuccess ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                              )}
                              <span className="truncate font-semibold text-zinc-100">
                                {renderHighlightedText(entry.command, terminalSearch)}
                              </span>
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
                              {typeof entry.durationMs === 'number' && (
                                <span className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-1.5 py-0.5 text-zinc-400">
                                  <Clock className="h-2.5 w-2.5" />
                                  {formatDurationMs(entry.durationMs)}
                                </span>
                              )}
                              {typeof entry.exitCode === 'number' && (
                                <span
                                  className={cn(
                                    'rounded px-1.5 py-0.5 font-semibold',
                                    entry.exitCode === 0
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : 'bg-rose-500/20 text-rose-300'
                                  )}
                                >
                                  exit {entry.exitCode}
                                </span>
                              )}
                              <span className="hidden text-zinc-500 sm:inline">
                                {formatClockTime(entry.timestamp)}
                              </span>
                              <button
                                type="button"
                                disabled={runningCmd}
                                onClick={() => void handleExecCommand(entry.command)}
                                title="Jalankan ulang perintah ini"
                                className="rounded p-1 text-zinc-400 opacity-70 transition hover:bg-zinc-800 hover:text-zinc-100 group-hover:opacity-100 disabled:opacity-30"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCopyEntry(entry)}
                                title="Salin blok ini"
                                className="rounded p-1 text-zinc-400 opacity-70 transition hover:bg-zinc-800 hover:text-zinc-100 group-hover:opacity-100"
                              >
                                {copiedEntryId === entry.id ? (
                                  <Check className="h-3 w-3 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          </div>
                        )}

                        {lines.length > 0 && (
                          <div
                            className={cn(
                              'px-3 py-2',
                              terminalWrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre'
                            )}
                          >
                            {lines.map((line, i) => (
                              <div key={i} className={classifyTerminalLine(line)}>
                                {line ? renderHighlightedText(line, terminalSearch) : '\u00A0'}
                              </div>
                            ))}
                          </div>
                        )}

                        {!entry.command && (
                          <div className="flex items-center justify-between border-t border-zinc-800/40 px-3 py-1 text-[10px] text-zinc-500">
                            <span>{formatClockTime(entry.timestamp)}</span>
                            <button
                              type="button"
                              onClick={() => void handleCopyEntry(entry)}
                              className="inline-flex items-center gap-1 hover:text-zinc-300"
                            >
                              {copiedEntryId === entry.id ? (
                                <Check className="h-2.5 w-2.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-2.5 w-2.5" />
                              )}
                              <span>Copy</span>
                            </button>
                          </div>
                        )}

                        {isError && entry.command && (
                          <div className="flex items-center justify-end border-t border-rose-500/20 px-3 py-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                triggerTerminalAutoFix(entry.command || 'command', entry.output)
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-rose-500/35 bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-200 hover:bg-rose-500/25"
                            >
                              <Sparkles className="h-3 w-3" />
                              <span>Tanya Emergent AI Fix Error Ini</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                {(runningCmd || deployingDaytona) && (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                    <span className="truncate">
                      {deployingDaytona
                        ? 'Menjalankan deploy & Vite dev server di Daytona VM...'
                        : `Menjalankan: ${runningCmdLabel || 'command'}...`}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-amber-300/80">
                      {formatDurationMs(elapsedMs)}
                    </span>
                  </div>
                )}
              </div>

              {showScrollBottomBtn && (
                <button
                  type="button"
                  onClick={() => {
                    terminalViewportRef.current?.scrollTo({
                      top: terminalViewportRef.current.scrollHeight,
                      behavior: 'smooth',
                    });
                    setShowScrollBottomBtn(false);
                  }}
                  className="absolute bottom-3 right-4 inline-flex items-center gap-1 rounded-full border border-border/80 bg-card/95 px-2.5 py-1 text-[10px] font-medium text-foreground shadow-lg backdrop-blur hover:border-primary/50 hover:text-primary"
                >
                  <ArrowDown className="h-3 w-3" />
                  <span>Ke bawah</span>
                </button>
              )}
            </div>

            {/* Interactive Prompt Input Bar */}
            <div className="flex shrink-0 flex-col gap-1 border-t border-border/80 bg-card/95 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-1 font-mono text-[11px] sm:flex">
                  <span className="font-semibold text-emerald-400">adam@daytona</span>
                  <span className="text-zinc-500">:</span>
                  <span className="text-sky-400">~/adam-app</span>
                  <span className="font-bold text-zinc-300">$</span>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-400 sm:hidden">$</span>

                <div className="relative flex-1">
                  <Input
                    ref={terminalInputRef}
                    value={terminalCmd}
                    onChange={(e) => {
                      setTerminalCmd(e.target.value);
                      setHistoryIdx(-1);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleExecCommand();
                      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
                        e.preventDefault();
                        handleClearTerminal();
                      } else if (e.key === 'Escape') {
                        setTerminalCmd('');
                        setHistoryIdx(-1);
                      } else if (e.key === 'ArrowUp') {
                        if (cmdHistory.length === 0) return;
                        e.preventDefault();
                        const nextIdx = Math.min(cmdHistory.length - 1, historyIdx + 1);
                        setHistoryIdx(nextIdx);
                        setTerminalCmd(cmdHistory[nextIdx]);
                      } else if (e.key === 'ArrowDown') {
                        if (historyIdx <= 0) {
                          setHistoryIdx(-1);
                          setTerminalCmd('');
                          return;
                        }
                        e.preventDefault();
                        const nextIdx = historyIdx - 1;
                        setHistoryIdx(nextIdx);
                        setTerminalCmd(cmdHistory[nextIdx]);
                      }
                    }}
                    placeholder="Ketik perintah bash (↑↓ history, Ctrl+L clear)..."
                    disabled={runningCmd}
                    className="h-8 rounded-xl bg-background/80 pr-7 font-mono text-xs"
                  />
                  {terminalCmd && !runningCmd && (
                    <button
                      type="button"
                      onClick={() => setTerminalCmd('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      title="Kosongkan input"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <Button
                  type="button"
                  size="sm"
                  disabled={runningCmd || !terminalCmd.trim()}
                  onClick={() => void handleExecCommand()}
                  className="h-8 shrink-0 gap-1.5 rounded-xl px-3 text-xs"
                >
                  {runningCmd ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="hidden sm:inline">{formatDurationMs(elapsedMs)}</span>
                    </>
                  ) : (
                    <span>Run</span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === 'plan' && (
          <div className="h-full overflow-y-auto p-4">
            {workspace.plan ? (
              <EmergentPlanCard plan={workspace.plan} fileCount={filePaths.length} />
            ) : (
              <div className="rounded-2xl border border-dashed border-border/80 bg-card/40 p-8 text-center text-xs text-muted-foreground">
                Blueprint & checklist task akan muncul di sini saat Emergent Agent membangun proyek.
              </div>
            )}
          </div>
        )}
      </div>
    
      <GitHubPushDialog
        open={pushDialogOpen}
        onOpenChange={setPushDialogOpen}
        files={
          !workspace?.files || Object.keys(workspace.files).length === 0
            ? []
            : workspace.files['package.json']
              ? Object.values(workspace.files).map((f) => ({ path: f.path, content: f.content }))
              : scaffoldRunnableProjectFiles(workspace.files, workspace.plan?.title)
        }
        githubToken={githubToken}
        defaultRepoSlug={githubProject?.owner && githubProject?.repo ? `${githubProject.owner}/${githubProject.repo}` : ""}
        defaultBranch={githubProject?.branch || "main"}
        activeModel={activeModel}
        apiKey={geminiApiKey}
        demoMode={demoMode}
      />
</aside>
  );
});
