import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns2,
  Copy,
  CornerDownLeft,
  Crosshair,
  Download,
  ExternalLink,
  Eye,
  Filter,
  GitCompare,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Sparkles,
  Sun,
  Tablet,
  Terminal,
  Trash2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StudioScroll } from '@/components/ui/studio-scroll';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { buildPreviewSrcDoc, getExtensionForLanguage } from '@/lib/artifacts';
import { computeLineDiff } from '@/lib/diff';
import type { ArtifactItem, VisualTarget } from '@/types/chat';
import { cn, formatBytes, generateId } from '@/lib/utils';

const LazyCodeMirrorEditor = lazy(() => import('@/components/CodeMirrorEditor'));

interface ConsoleEntry {
  id: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

type CanvasTab = 'preview' | 'code' | 'split' | 'diff' | 'console';

interface ArtifactPanelProps {
  artifact: ArtifactItem;
  allArtifacts: ArtifactItem[];
  isResizing: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onSelectArtifact: (artifact: ArtifactItem) => void;
  onSelectVisualTarget?: (target: VisualTarget) => void;
  onFixErrorWithAi?: (errorMessage: string, artifact: ArtifactItem) => void;
  onInsertToChat?: (text: string) => void;
  onClose: () => void;
}

export const ArtifactPanel = memo(function ArtifactPanel({
  artifact,
  allArtifacts,
  isResizing,
  isFullscreen,
  onToggleFullscreen,
  onSelectArtifact,
  onSelectVisualTarget,
  onFixErrorWithAi,
  onInsertToChat,
  onClose,
}: ArtifactPanelProps) {
  const canPreview =
    artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'markdown';
  const isHtmlOrSvg = artifact.kind === 'html' || artifact.kind === 'svg';

  const [tab, setTab] = useState<CanvasTab>(canPreview ? 'preview' : 'code');
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [zoomPct, setZoomPct] = useState<50 | 75 | 100>(100);
  const [previewBg, setPreviewBg] = useState<'dark' | 'light'>('dark');

  const [editableContent, setEditableContent] = useState(artifact.content);
  const [debouncedContent, setDebouncedContent] = useState(artifact.content);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [compareBaselineId, setCompareBaselineId] = useState<string>('original');
  const [changesOnlyDiff, setChangesOnlyDiff] = useState(false);
  const [localSnapshots, setLocalSnapshots] = useState<ArtifactItem[]>([]);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const prevArtifactIdRef = useRef<string>(artifact.id);
  const prevBaseContentRef = useRef<string>(artifact.content);
  const artifactsRootKey = allArtifacts[0]?.id || artifact.id;
  const prevRootKeyRef = useRef<string>(artifactsRootKey);

  useEffect(() => {
    if (prevRootKeyRef.current !== artifactsRootKey) {
      const stillInSnapshots = localSnapshots.some((s) => s.id === artifact.id);
      if (!stillInSnapshots) {
        setLocalSnapshots([]);
        prevRootKeyRef.current = artifactsRootKey;
      }
    }
  }, [artifactsRootKey, artifact.id, localSnapshots]);

  const mergedArtifacts = useMemo(
    () => [...allArtifacts, ...localSnapshots],
    [allArtifacts, localSnapshots]
  );

  const currentVersionIdx = useMemo(() => {
    const idx = mergedArtifacts.findIndex((a) => a.id === artifact.id);
    return idx >= 0 ? idx : mergedArtifacts.length - 1;
  }, [mergedArtifacts, artifact.id]);

  useEffect(() => {
    if (prevArtifactIdRef.current !== artifact.id) {
      if (editableContent !== prevBaseContentRef.current) {
        draftsRef.current.set(prevArtifactIdRef.current, editableContent);
      } else {
        draftsRef.current.delete(prevArtifactIdRef.current);
      }
      prevArtifactIdRef.current = artifact.id;
      prevBaseContentRef.current = artifact.content;
    }

    const restoredDraft = draftsRef.current.get(artifact.id) ?? artifact.content;
    setEditableContent(restoredDraft);
    setDebouncedContent(restoredDraft);
    setRuntimeError(null);
    setConsoleLogs([]);

    if (!isHtmlOrSvg) {
      setInspectMode(false);
    }

    if (currentVersionIdx > 0 && mergedArtifacts[currentVersionIdx - 1]) {
      setCompareBaselineId(mergedArtifacts[currentVersionIdx - 1].id);
    } else {
      setCompareBaselineId('original');
    }

    setTab((prevTab) => {
      if (prevTab === 'code' || prevTab === 'diff') return prevTab;
      if (prevTab === 'split' && canPreview) return 'split';
      if (prevTab === 'console' && isHtmlOrSvg) return 'console';
      return canPreview ? 'preview' : 'code';
    });
  }, [artifact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sendInspectToggleToIframe(inspectMode);
  }, [inspectMode]);

  // Debounce 250ms saat mengedit di IDE/Split agar iframe preview tidak kedip per ketukan
  useEffect(() => {
    if (editableContent === artifact.content) {
      setDebouncedContent(editableContent);
      return;
    }
    const t = window.setTimeout(() => setDebouncedContent(editableContent), 250);
    return () => window.clearTimeout(t);
  }, [editableContent, artifact.content]);

  const sendInspectToggleToIframe = (enabled: boolean) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'hydrogen-inspector-toggle', enabled },
      '*'
    );
  };

  const toggleInspectMode = () => {
    const next = !inspectMode;
    if (next && zoomPct !== 100) {
      setZoomPct(100);
    }
    setInspectMode(next);
    sendInspectToggleToIframe(next);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWin = iframeRef.current?.contentWindow;
      if (!frameWin || event.source !== frameWin) return;
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
    const idx = mergedArtifacts.findIndex((a) => a.id === compareBaselineId);
    if (idx === -1) return 'Asli Artifact Ini';
    return `v${idx + 1}: ${mergedArtifacts[idx].title}`;
  }, [mergedArtifacts, compareBaselineId]);

  const baselineContent = useMemo(() => {
    if (compareBaselineId === 'original') return artifact.content;
    const found = mergedArtifacts.find((a) => a.id === compareBaselineId);
    return found ? found.content : artifact.content;
  }, [mergedArtifacts, artifact.content, compareBaselineId]);

  const handleSaveLocalSnapshot = () => {
    const nextIdx = mergedArtifacts.length + 1;
    const snapshot: ArtifactItem = {
      ...artifact,
      id: `${artifact.id}-edit-${Date.now()}`,
      title: `${artifact.title} (Edit v${nextIdx})`,
      content: editableContent,
    };
    draftsRef.current.delete(artifact.id);
    setLocalSnapshots((prev) => [...prev, snapshot]);
    onSelectArtifact(snapshot);
    toast.success(`Versi lokal "${snapshot.title}" disimpan`);
  };

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

  const currentArtifact: ArtifactItem = useMemo(
    () => ({ ...artifact, content: debouncedContent }),
    [artifact, debouncedContent]
  );
  const previewSrcDoc = useMemo(
    () => (isHtmlOrSvg ? buildPreviewSrcDoc(currentArtifact, previewBg) : ''),
    [currentArtifact, isHtmlOrSvg, previewBg]
  );

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

  const handleOpenNewTab = () => {
    if (!isHtmlOrSvg) return;
    const htmlStr = buildPreviewSrcDoc(currentArtifact, previewBg);
    const blob = new Blob([htmlStr], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const lineCount = useMemo(() => editableContent.split('\n').length, [editableContent]);
  const isModified = editableContent !== artifact.content;
  const viewportWidthLabel =
    viewport === 'mobile' ? '375px' : viewport === 'tablet' ? '768px' : '100%';

  const tabItems: Array<{
    id: CanvasTab;
    label: string;
    icon: typeof Eye;
    desktopOnly?: boolean;
  }> = [
    ...(canPreview ? [{ id: 'preview' as const, label: 'Preview', icon: Eye }] : []),
    { id: 'code', label: 'IDE', icon: Code2 },
    ...(canPreview
      ? [{ id: 'split' as const, label: 'Split', icon: Columns2, desktopOnly: true }]
      : []),
    { id: 'diff', label: 'Diff', icon: GitCompare },
    ...(isHtmlOrSvg ? [{ id: 'console' as const, label: 'Console', icon: Terminal }] : []),
  ];

  const renderPreviewFrame = () => {
    if (artifact.kind === 'markdown') {
      return (
        <StudioScroll className="h-full w-full" autoHide="scroll">
          <div className="p-4 sm:p-6">
            <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-5 shadow-sm">
              <MarkdownRenderer content={debouncedContent} />
            </div>
          </div>
        </StudioScroll>
      );
    }

    const showDeviceFrame = viewport !== 'desktop';

    return (
      <div className="flex h-full w-full items-center justify-center p-2 sm:p-3.5">
        <div
          className={cn(
            'flex h-full flex-col overflow-hidden border bg-zinc-950 shadow-2xl transition-all duration-200',
            showDeviceFrame ? 'rounded-2xl border-zinc-700/80 ring-1 ring-white/10' : 'rounded-xl',
            viewport === 'mobile'
              ? 'w-[375px] max-w-full'
              : viewport === 'tablet'
                ? 'w-[768px] max-w-full'
                : 'w-full'
          )}
        >
          {showDeviceFrame && (
            <div className="flex h-6 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3 text-[10px] font-mono text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {viewport === 'mobile' ? 'Mobile Viewport' : 'Tablet Viewport'}
              </span>
              <span>{viewportWidthLabel}</span>
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              style={
                zoomPct === 100
                  ? { width: '100%', height: '100%' }
                  : {
                      width: `${(100 / zoomPct) * 100}%`,
                      height: `${(100 / zoomPct) * 100}%`,
                      transform: `scale(${zoomPct / 100})`,
                      transformOrigin: 'top left',
                    }
              }
            >
              <iframe
                ref={iframeRef}
                key={`${artifact.id}-${refreshSeed}`}
                title={artifact.title}
                sandbox="allow-scripts"
                onLoad={() => {
                  if (inspectMode) sendInspectToggleToIframe(true);
                }}
                srcDoc={previewSrcDoc}
                className={cn('h-full w-full border-0', isResizing && 'pointer-events-none')}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderEditor = () => (
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
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Row 1: Compact Responsive Header (anti-sesak di HP) */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 sm:px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold">{artifact.title}</span>
              <Badge
                variant="outline"
                className="hidden px-1.5 py-0 font-mono text-[10px] sm:inline-flex"
              >
                {artifact.language}
              </Badge>
              {isModified && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Modified" />
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {mergedArtifacts.length > 1 && (
            <div className="flex items-center rounded-lg border bg-background/70 p-0.5">
              <button
                type="button"
                disabled={currentVersionIdx <= 0}
                onClick={() => onSelectArtifact(mergedArtifacts[currentVersionIdx - 1])}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                title="Versi Sebelumnya"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[11px] font-medium hover:text-primary"
                  >
                    <Layers className="hidden h-3 w-3 text-primary sm:inline" />
                    <span>
                      v{currentVersionIdx + 1}/{mergedArtifacts.length}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                  {mergedArtifacts.map((item, idx) => (
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
                disabled={currentVersionIdx >= mergedArtifacts.length - 1}
                onClick={() => onSelectArtifact(mergedArtifacts[currentVersionIdx + 1])}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                title="Versi Berikutnya"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <Button type="button" variant="ghost" size="icon" onClick={handleCopy} title="Copy code">
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </Button>

          {/* Desktop Quick Actions */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            className="hidden sm:inline-flex"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </Button>
          {isHtmlOrSvg && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleOpenNewTab}
              className="hidden sm:inline-flex"
              title="Buka di Tab Baru"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
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

          {/* Mobile Overflow Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="sm:hidden"
                aria-label="Aksi Canvas"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {isHtmlOrSvg && (
                <DropdownMenuItem onClick={handleOpenNewTab}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Buka di Tab Baru
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
                Download File
              </DropdownMenuItem>
              {isModified && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setEditableContent(artifact.content);
                      setRuntimeError(null);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Perubahan
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button type="button" variant="ghost" size="icon" onClick={onClose} title="Tutup Canvas">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Row 2: Segmented Tabs + Preview Tools */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-3 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-xl border bg-background/70 p-0.5">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  if (item.id !== 'preview' && item.id !== 'split') setInspectMode(false);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  item.desktopOnly && 'hidden md:inline-flex',
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

        {(tab === 'preview' || tab === 'split') && isHtmlOrSvg && (
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

            {/* Preview Zoom Toggle (50% / 75% / 100%) — sangat berguna di HP & Split Pane */}
            <div className="flex items-center rounded-lg border bg-background/70 p-0.5">
              <button
                type="button"
                onClick={() => setZoomPct((z) => (z === 100 ? 75 : z === 75 ? 50 : 100))}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Ubah Zoom Preview (50% / 75% / 100%)"
              >
                {zoomPct < 100 ? (
                  <ZoomIn className="h-3 w-3 text-primary" />
                ) : (
                  <ZoomOut className="h-3 w-3" />
                )}
                <span>{zoomPct}%</span>
              </button>
            </div>

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

      {inspectMode && (tab === 'preview' || tab === 'split') && (
        <div className="flex items-center justify-between border-b border-primary/30 bg-primary/10 px-3.5 py-1.5 text-[11px] text-primary">
          <span className="flex items-center gap-1.5 font-medium">
            <Crosshair className="h-3.5 w-3.5 shrink-0" />
            <span>Inspector Aktif: Ketuk elemen di preview untuk edit langsung via AI.</span>
          </span>
          <button type="button" onClick={toggleInspectMode} className="shrink-0 underline">
            Batal
          </button>
        </div>
      )}

      {runtimeError && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono">{runtimeError}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onFixErrorWithAi && (
              <Button
                type="button"
                size="sm"
                onClick={() => onFixErrorWithAi(runtimeError, currentArtifact)}
                className="h-6 gap-1 rounded-md px-2 text-[11px]"
              >
                <Wand2 className="h-3 w-3" />
                Fix with AI
              </Button>
            )}
            <button
              type="button"
              onClick={() => setTab('console')}
              className="text-[11px] font-semibold underline"
            >
              Console
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/15">
        {tab === 'preview' && canPreview ? (
          renderPreviewFrame()
        ) : tab === 'split' && canPreview ? (
          <div className="grid h-full w-full grid-cols-1 grid-rows-2 divide-y overflow-hidden lg:grid-cols-2 lg:grid-rows-1 lg:divide-x lg:divide-y-0">
            <div className="h-full min-h-0 min-w-0 overflow-hidden">{renderEditor()}</div>
            <div className="h-full min-h-0 min-w-0 overflow-hidden">{renderPreviewFrame()}</div>
          </div>
        ) : tab === 'diff' ? (
          <div className="flex h-full flex-col overflow-hidden">
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
                      <span className="max-w-[160px] truncate font-mono">{baselineLabel}</span>
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
                    {mergedArtifacts.map((item, idx) =>
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

            <StudioScroll axis="both" autoHide="never" className="min-h-0 flex-1 bg-[#0b0d12]">
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
            </StudioScroll>
          </div>
        ) : tab === 'console' ? (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card/50 px-3.5 py-2 text-xs text-muted-foreground">
              <span>Live Sandbox Console Output</span>
              <div className="flex items-center gap-1.5">
                {onInsertToChat && consoleLogs.some((e) => e.level === 'error') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const errs = consoleLogs
                        .filter((e) => e.level === 'error')
                        .map((e) => `- ${e.message}`)
                        .join('\n');
                      onInsertToChat(
                        `[Console Errors pada \`${artifact.title}\`]:\n\`\`\`\n${errs}\n\`\`\`\nTolong perbaiki error di atas:`
                      );
                      toast.success('Semua error dimasukkan ke chat');
                    }}
                    className="h-6 gap-1 rounded-md border-destructive/40 bg-destructive/10 px-2 text-[11px] text-destructive hover:bg-destructive/20"
                  >
                    <CornerDownLeft className="h-3 w-3" />
                    <span>Kirim Semua Error</span>
                  </Button>
                )}
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
            </div>
            <StudioScroll className="min-h-0 flex-1" autoHide="scroll">
              <div className="space-y-1.5 p-3 font-mono text-xs">
                {consoleLogs.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground">
                    Belum ada log atau error dari preview iframe.
                  </div>
                ) : (
                  consoleLogs.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        'group flex items-start justify-between gap-2 rounded-lg border px-3 py-2 break-words',
                        entry.level === 'error'
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : entry.level === 'warn'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                            : 'bg-card text-foreground'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="mr-2 text-[10px] uppercase opacity-70">[{entry.level}]</span>
                        {entry.message}
                      </div>
                      {onInsertToChat && (
                        <button
                          type="button"
                          onClick={() => {
                            onInsertToChat(
                              `[Console ${entry.level.toUpperCase()} pada \`${artifact.title}\`]:\n\`\`\`\n${entry.message}\n\`\`\`\nTolong cek / perbaiki bagian ini:`
                            );
                            toast.success('Log dimasukkan ke kolom chat');
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-0.5 font-sans text-[10px] font-medium text-foreground opacity-90 transition-opacity hover:bg-accent md:opacity-0 md:group-hover:opacity-100"
                          title="Masukkan ke kolom chat"
                        >
                          <CornerDownLeft className="h-3 w-3 text-primary" />
                          <span>Ke Chat</span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </StudioScroll>
          </div>
        ) : (
          <div className="h-full w-full overflow-hidden">{renderEditor()}</div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t bg-card/80 px-3 font-mono text-[10px] text-muted-foreground">
        <div className="flex items-center gap-2.5">
          <span>{lineCount.toLocaleString()} lines</span>
          <span>•</span>
          <span>{formatBytes(editableContent.length)}</span>
          {isModified && (
            <>
              <span>•</span>
              <button
                type="button"
                onClick={handleSaveLocalSnapshot}
                className="font-semibold text-primary hover:underline"
              >
                Simpan Versi
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  draftsRef.current.delete(artifact.id);
                  setEditableContent(artifact.content);
                  setRuntimeError(null);
                }}
                className="text-amber-400 hover:underline"
              >
                Reset edits
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isHtmlOrSvg && <span>{viewportWidthLabel}</span>}
          <span className={runtimeError ? 'text-destructive' : 'text-emerald-400'}>
            {runtimeError ? '● Error' : '● Ready'}
          </span>
        </div>
      </div>
    </div>
  );
});
