import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Crosshair,
  Download,
  Eye,
  Filter,
  GitCompare,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Sparkles,
  Sun,
  Tablet,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { buildPreviewSrcDoc, getExtensionForLanguage } from '@/lib/artifacts';
import { computeLineDiff } from '@/lib/diff';
import type { ArtifactItem, VisualTarget } from '@/types/chat';
import { cn, generateId } from '@/lib/utils';

// Lazy-load CodeMirror agar buka Canvas di tab Preview tetap instan 0ms
const LazyCodeMirrorEditor = lazy(() => import('@/components/CodeMirrorEditor'));

interface ConsoleEntry {
  id: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

interface ArtifactPanelProps {
  artifact: ArtifactItem;
  allArtifacts: ArtifactItem[];
  isResizing: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onSelectArtifact: (artifact: ArtifactItem) => void;
  onSelectVisualTarget?: (target: VisualTarget) => void;
  onClose: () => void;
}

export function ArtifactPanel({
  artifact,
  allArtifacts,
  isResizing,
  isFullscreen,
  onToggleFullscreen,
  onSelectArtifact,
  onSelectVisualTarget,
  onClose,
}: ArtifactPanelProps) {
  const canPreview =
    artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'markdown';

  const [tab, setTab] = useState<'preview' | 'code' | 'diff' | 'console'>(
    canPreview ? 'preview' : 'code'
  );
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewBg, setPreviewBg] = useState<'dark' | 'light'>('dark');
  const [editableContent, setEditableContent] = useState(artifact.content);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [compareBaselineId, setCompareBaselineId] = useState<string>('original');
  const [changesOnlyDiff, setChangesOnlyDiff] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const currentVersionIdx = useMemo(() => {
    const idx = allArtifacts.findIndex((a) => a.id === artifact.id);
    return idx >= 0 ? idx : allArtifacts.length - 1;
  }, [allArtifacts, artifact.id]);

  useEffect(() => {
    setEditableContent(artifact.content);
    setRuntimeError(null);
    setConsoleLogs([]);
    setInspectMode(false);
    if (currentVersionIdx > 0 && allArtifacts[currentVersionIdx - 1]) {
      setCompareBaselineId(allArtifacts[currentVersionIdx - 1].id);
    } else {
      setCompareBaselineId('original');
    }
    setTab(
      artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'markdown'
        ? 'preview'
        : 'code'
    );
  }, [artifact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendInspectToggleToIframe = (enabled: boolean) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'hydrogen-inspector-toggle', enabled },
      '*'
    );
  };

  const toggleInspectMode = () => {
    const next = !inspectMode;
    setInspectMode(next);
    sendInspectToggleToIframe(next);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'hydrogen-artifact-error') {
        const msg = String(event.data.message || 'Runtime Error');
        setRuntimeError(msg);
        setConsoleLogs((prev) => [
          ...prev.slice(-49),
          { id: `${Date.now()}-${Math.random()}`, level: 'error', message: msg },
        ]);
      } else if (event.data?.type === 'hydrogen-artifact-console') {
        const lvl =
          event.data.level === 'warn' || event.data.level === 'error'
            ? event.data.level
            : 'log';
        setConsoleLogs((prev) => [
          ...prev.slice(-49),
          {
            id: `${Date.now()}-${Math.random()}`,
            level: lvl,
            message: String(event.data.message || ''),
          },
        ]);
      } else if (event.data?.type === 'hydrogen-artifact-element-selected') {
        const payload = event.data.payload;
        if (payload && onSelectVisualTarget) {
          setInspectMode(false);
          onSelectVisualTarget({
            id: generateId(),
            tagName: String(payload.tagName || 'element'),
            selector: String(payload.selector || 'element'),
            textSnippet: String(payload.textSnippet || ''),
            outerHtml: String(payload.outerHtml || ''),
          });
          toast.success(`Elemen <${payload.selector}> ditandai ke Composer!`);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelectVisualTarget]);

  const baselineLabel = useMemo(() => {
    if (compareBaselineId === 'original') return 'Asli Artifact Ini';
    const idx = allArtifacts.findIndex((a) => a.id === compareBaselineId);
    if (idx === -1) return 'Asli Artifact Ini';
    return `v${idx + 1}: ${allArtifacts[idx].title}`;
  }, [allArtifacts, compareBaselineId]);

  const baselineContent = useMemo(() => {
    if (compareBaselineId === 'original') return artifact.content;
    const found = allArtifacts.find((a) => a.id === compareBaselineId);
    return found ? found.content : artifact.content;
  }, [allArtifacts, artifact.content, compareBaselineId]);

  const diffLines = useMemo(() => {
    if (tab !== 'diff') return [];
    return computeLineDiff(baselineContent, editableContent);
  }, [baselineContent, editableContent, tab]);

  const displayedDiffLines = useMemo(() => {
    if (!changesOnlyDiff) return diffLines;
    const include = new Array<boolean>(diffLines.length).fill(false);
    for (let i = 0; i < diffLines.length; i++) {
      if (diffLines[i].type !== 'same') {
        for (let k = Math.max(0, i - 2); k <= Math.min(diffLines.length - 1, i + 2); k++) {
          include[k] = true;
        }
      }
    }
    return diffLines.filter((_, idx) => include[idx]);
  }, [diffLines, changesOnlyDiff]);

  const diffStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const d of diffLines) {
      if (d.type === 'add') added += 1;
      if (d.type === 'remove') removed += 1;
    }
    return { added, removed };
  }, [diffLines]);

  const currentArtifact: ArtifactItem = {
    ...artifact,
    content: editableContent,
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editableContent);
      setCopied(true);
      toast.success('Kode artifact disalin');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Gagal menyalin');
    }
  };

  const handleDownload = () => {
    const ext = getExtensionForLanguage(artifact.language);
    const blob = new Blob([editableContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Mengunduh artifact.${ext}`);
  };

  const viewportWidthLabel =
    viewport === 'mobile' ? '375px' : viewport === 'tablet' ? '768px' : '100%';

  const tabItems: Array<{ id: 'preview' | 'code' | 'diff' | 'console'; label: string; icon: typeof Eye }> = [
    ...(canPreview ? [{ id: 'preview' as const, label: 'Preview', icon: Eye }] : []),
    { id: 'code', label: 'IDE', icon: Code2 },
    { id: 'diff', label: 'Diff', icon: GitCompare },
    ...((artifact.kind === 'html' || artifact.kind === 'svg')
      ? [{ id: 'console' as const, label: 'Console', icon: Terminal }]
      : []),
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Row 1: Header Utama Canvas */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold">{artifact.title}</span>
              <Badge
                variant="outline"
                className="hidden px-1.5 py-0 font-mono text-[10px] sm:inline-flex"
              >
                {artifact.language}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{editableContent.split('\n').length} lines</span>
              {editableContent !== artifact.content && (
                <span className="font-medium text-amber-400">• Modified</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {editableContent !== artifact.content && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditableContent(artifact.content);
                setRuntimeError(null);
              }}
              title="Reset ke versi asli"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" onClick={handleCopy} title="Copy code">
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            title="Download"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleFullscreen}
            className="hidden lg:inline-flex"
            title={isFullscreen ? 'Keluar Fullscreen' : 'Fullscreen Canvas'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} title="Tutup Canvas">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Row 2: Segmented Tabs + Preview Tools + Version Stepper */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-3 py-2">
        <div className="inline-flex items-center gap-1 rounded-xl border bg-background/70 p-0.5">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  if (item.id !== 'preview') setInspectMode(false);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3 w-3" />
                <span>{item.label}</span>
                {item.id === 'console' && consoleLogs.length > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[10px]',
                      active ? 'bg-black/20 text-white' : 'bg-primary/20 text-primary'
                    )}
                  >
                    {consoleLogs.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {allArtifacts.length > 1 && (
            <div className="flex items-center rounded-xl border bg-background/70 p-0.5">
              <button
                type="button"
                disabled={currentVersionIdx <= 0}
                onClick={() => onSelectArtifact(allArtifacts[currentVersionIdx - 1])}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                title="Versi Sebelumnya"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] font-medium hover:text-primary"
                  >
                    <Layers className="h-3 w-3 text-primary" />
                    <span>
                      v{currentVersionIdx + 1}/{allArtifacts.length}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                  {allArtifacts.map((item, idx) => (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => onSelectArtifact(item)}
                      className="justify-between"
                    >
                      <span className="truncate font-mono">
                        v{idx + 1}: {item.title}
                      </span>
                      {item.id === artifact.id && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                disabled={currentVersionIdx >= allArtifacts.length - 1}
                onClick={() => onSelectArtifact(allArtifacts[currentVersionIdx + 1])}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                title="Versi Berikutnya"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {tab === 'preview' && (artifact.kind === 'html' || artifact.kind === 'svg') && (
            <div className="flex items-center gap-1">
              {onSelectVisualTarget && (
                <Button
                  type="button"
                  variant={inspectMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleInspectMode}
                  className="h-7 gap-1 rounded-lg px-2 text-[11px]"
                  title="Klik elemen di preview untuk mengeditnya langsung dengan AI"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  <span>{inspectMode ? 'Pilih...' : 'Inspect'}</span>
                </Button>
              )}

              <div className="hidden items-center rounded-lg border bg-background/70 p-0.5 sm:flex">
                <button
                  type="button"
                  onClick={() => setViewport('desktop')}
                  className={cn(
                    'rounded-md p-1 transition-colors',
                    viewport === 'desktop'
                      ? 'bg-accent text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  )}
                  title="Desktop (100%)"
                >
                  <Monitor className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('tablet')}
                  className={cn(
                    'rounded-md p-1 transition-colors',
                    viewport === 'tablet'
                      ? 'bg-accent text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  )}
                  title="Tablet (768px)"
                >
                  <Tablet className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewport('mobile')}
                  className={cn(
                    'rounded-md p-1 transition-colors',
                    viewport === 'mobile'
                      ? 'bg-accent text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  )}
                  title="Mobile (375px)"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>

              <span className="hidden font-mono text-[10px] text-muted-foreground md:inline">
                {viewportWidthLabel}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setRuntimeError(null);
                  setConsoleLogs([]);
                  setRefreshSeed((s) => s + 1);
                }}
                className="h-7 w-7"
                title="Reload Preview"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPreviewBg((b) => (b === 'dark' ? 'light' : 'dark'))}
                className="h-7 w-7"
                title="Toggle Backdrop Light/Dark"
              >
                {previewBg === 'dark' ? (
                  <Sun className="h-3.5 w-3.5" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {inspectMode && tab === 'preview' && (
        <div className="flex items-center justify-between border-b border-primary/30 bg-primary/10 px-3.5 py-1.5 text-[11px] text-primary">
          <span className="flex items-center gap-1.5 font-medium">
            <Crosshair className="h-3.5 w-3.5" />
            Inspector Aktif: Ketuk atau klik elemen mana saja pada preview untuk diedit AI.
          </span>
          <button type="button" onClick={toggleInspectMode} className="underline">
            Batal
          </button>
        </div>
      )}

      {runtimeError && (
        <div className="flex items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono">{runtimeError}</span>
          </div>
          <button
            type="button"
            onClick={() => setTab('console')}
            className="shrink-0 text-[11px] font-semibold underline"
          >
            Lihat Console
          </button>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/15">
        {tab === 'preview' && canPreview ? (
          artifact.kind === 'markdown' ? (
            <div className="h-full w-full overflow-y-auto p-4 sm:p-6">
              <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-5 shadow-sm">
                <MarkdownRenderer content={editableContent} />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-2.5 sm:p-4">
              <div
                className={cn(
                  'h-full overflow-hidden rounded-xl border bg-zinc-950 shadow-2xl transition-all duration-200',
                  viewport === 'mobile'
                    ? 'w-[375px] max-w-full'
                    : viewport === 'tablet'
                      ? 'w-[768px] max-w-full'
                      : 'w-full'
                )}
              >
                <iframe
                  ref={iframeRef}
                  key={`${artifact.id}-${refreshSeed}`}
                  title={artifact.title}
                  sandbox="allow-scripts"
                  onLoad={() => sendInspectToggleToIframe(inspectMode)}
                  srcDoc={buildPreviewSrcDoc(currentArtifact, previewBg)}
                  className={cn('h-full w-full border-0', isResizing && 'pointer-events-none')}
                />
              </div>
            </div>
          )
        ) : tab === 'diff' ? (
          <div className="flex h-full flex-col overflow-hidden">
            {/* Upgraded Shadcn Diff Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card/70 px-3.5 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Bandingkan:
                </span>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 rounded-lg px-2.5 text-xs font-normal"
                    >
                      <span className="max-w-[170px] truncate font-mono">{baselineLabel}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
                    <DropdownMenuItem
                      onClick={() => setCompareBaselineId('original')}
                      className="justify-between"
                    >
                      <span>Asli Artifact Ini</span>
                      {compareBaselineId === 'original' && (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      )}
                    </DropdownMenuItem>
                    {allArtifacts.map((item, idx) =>
                      item.id === artifact.id ? null : (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() => setCompareBaselineId(item.id)}
                          className="justify-between"
                        >
                          <span className="truncate font-mono">
                            v{idx + 1}: {item.title}
                          </span>
                          {compareBaselineId === item.id && (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          )}
                        </DropdownMenuItem>
                      )
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="button"
                  variant={changesOnlyDiff ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setChangesOnlyDiff((c) => !c)}
                  className={cn(
                    'h-7 gap-1 rounded-lg px-2 text-[11px]',
                    changesOnlyDiff && 'border border-primary/35 text-primary'
                  )}
                >
                  <Filter className="h-3 w-3" />
                  <span>Perubahan Saja</span>
                </Button>
              </div>

              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">
                  +{diffStats.added}
                </span>
                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-400">
                  -{diffStats.removed}
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-[#0b0d12]">
              {displayedDiffLines.length === 0 ? (
                <div className="py-16 text-center text-xs text-zinc-500">
                  Tidak ada perbedaan baris dengan versi pembanding.
                </div>
              ) : (
                <div className="min-w-full py-2 font-mono text-[12px] leading-6">
                  {displayedDiffLines.map((d, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex whitespace-pre px-3',
                        d.type === 'add' && 'bg-emerald-500/15 text-emerald-200',
                        d.type === 'remove' && 'bg-rose-500/15 text-rose-200',
                        d.type === 'same' && 'text-zinc-400'
                      )}
                    >
                      <span className="w-8 shrink-0 select-none text-right text-[10px] text-zinc-600">
                        {d.oldLineNum ?? ''}
                      </span>
                      <span className="w-8 shrink-0 select-none text-right text-[10px] text-zinc-600">
                        {d.newLineNum ?? ''}
                      </span>
                      <span className="w-5 shrink-0 select-none text-center">
                        {d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' '}
                      </span>
                      <span>{d.line}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : tab === 'console' ? (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b bg-card/50 px-3.5 py-2 text-xs text-muted-foreground">
              <span>Live Sandbox Console Output</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConsoleLogs([]);
                  setRuntimeError(null);
                }}
                className="h-6 gap-1 px-2 text-[11px]"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3 font-mono text-xs">
              {consoleLogs.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  Belum ada log atau error dari preview iframe.
                </div>
              ) : (
                consoleLogs.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      'rounded-lg border px-3 py-2 break-words',
                      entry.level === 'error'
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : entry.level === 'warn'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                          : 'bg-card text-foreground'
                    )}
                  >
                    <span className="mr-2 text-[10px] uppercase opacity-70">[{entry.level}]</span>
                    {entry.message}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="h-full w-full overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>Memuat IDE Editor...</span>
                </div>
              }
            >
              <LazyCodeMirrorEditor
                value={editableContent}
                language={artifact.language}
                onChange={(val) => {
                  setEditableContent(val);
                  setRuntimeError(null);
                }}
              />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
