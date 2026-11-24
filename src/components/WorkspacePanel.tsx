import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  Code2,
  Copy,
  Eye,
  FileCode2,
  FolderTree,
  Laptop,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Rocket,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmergentPlanCard } from '@/components/EmergentPlanCard';
import { buildProjectZipBlob, compileWorkspaceToHtml } from '@/lib/workspace';
import { cn, copyToClipboard } from '@/lib/utils';
import type { VirtualWorkspace } from '@/types/chat';

const LazyCodeMirrorEditor = lazy(() => import('@/components/CodeMirrorEditor'));

interface WorkspacePanelProps {
  workspace: VirtualWorkspace;
  onChangeActiveFile: (path: string) => void;
  onEditFile: (path: string, content: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onAutoFixError: (errorMsg: string) => void;
  onClose: () => void;
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';
type WorkspaceTab = 'preview' | 'code' | 'plan';

export const WorkspacePanel = memo(function WorkspacePanel({
  workspace,
  onChangeActiveFile,
  onEditFile,
  onCreateFile,
  onDeleteFile,
  onAutoFixError,
  onClose,
}: WorkspacePanelProps) {
  const [tab, setTab] = useState<WorkspaceTab>('preview');
  const [viewport, setViewport] = useState<ViewportSize>('desktop');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelWidthPct, setPanelWidthPct] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const asideRef = useRef<HTMLElement>(null);

  const filePaths = useMemo(() => Object.keys(workspace.files).sort(), [workspace.files]);
  const activePath =
    workspace.activePath && workspace.files[workspace.activePath]
      ? workspace.activePath
      : filePaths[0] || '';
  const activeFile = activePath ? workspace.files[activePath] : null;

  const compiled = useMemo(() => compileWorkspaceToHtml(workspace), [workspace]);

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
      style={!isFullscreen ? { ['--ws-w' as string]: panelWidthPct + '%' } : undefined}
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
              {compiled.mode === 'react-tsx' ? 'React + TSX + Tailwind' : 'HTML / CSS / JS'}
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
              onClick={() => setTab('plan')}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors sm:px-2.5',
                tab === 'plan'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
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
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? "Keluar Fullscreen" : "Fullscreen"}
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

      {tab === 'preview' && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/50 px-3.5 py-1.5">
          <div className="flex items-center gap-1">
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
            {!isFullscreen && (
              <div className="ml-2 hidden items-center gap-1 border-l border-border/60 pl-2 font-mono text-[10px] text-muted-foreground lg:flex">
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
              <span>Reload</span>
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden bg-background/60">
        {tab === 'preview' && (
          <div className="flex h-full w-full flex-col items-center overflow-hidden p-2 sm:p-3">
            {runtimeError && (
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
            <div
              className={cn(
                'min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-border/80 bg-zinc-950 shadow-lg transition-[width] duration-200',
                viewportWidthClass
              )}
            >
              <iframe
                key={workspace.updatedAt + '-' + refreshNonce}
                title="Emergent Live Preview"
                srcDoc={compiled.html}
                sandbox="allow-scripts allow-modals allow-forms"
                className={cn('h-full w-full border-0 bg-zinc-950', isResizing && 'pointer-events-none')}
              />
            </div>
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
    </aside>
  );
});
