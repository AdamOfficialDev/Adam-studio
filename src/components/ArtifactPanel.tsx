import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Crosshair,
  Download,
  Eye,
  GitCompare,
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
import { StudioScroll } from '@/components/ui/studio-scroll';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { buildPreviewSrcDoc, getExtensionForLanguage } from '@/lib/artifacts';
import { computeLineDiff } from '@/lib/diff';
import type { ArtifactItem, VisualTarget } from '@/types/chat';
import { cn, generateId } from '@/lib/utils';

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

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setEditableContent(artifact.content);
    setRuntimeError(null);
    setConsoleLogs([]);
    setInspectMode(false);
    const currentIdx = allArtifacts.findIndex((a) => a.id === artifact.id);
    if (currentIdx > 0) {
      setCompareBaselineId(allArtifacts[currentIdx - 1].id);
    } else {
      setCompareBaselineId('original');
    }
    setTab(
      artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'markdown'
        ? 'preview'
        : 'code'
    );
  }, [artifact, allArtifacts]);

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

  const codeMirrorExtensions = useMemo(() => {
    const lang = artifact.language.toLowerCase();
    if (lang === 'html' || lang === 'htm' || lang === 'svg') return [html()];
    if (lang === 'css') return [css()];
    if (lang === 'markdown' || lang === 'md') return [markdown()];
    return [javascript({ jsx: true, typescript: true })];
  }, [artifact.language]);

  const baselineContent = useMemo(() => {
    if (compareBaselineId === 'original') return artifact.content;
    const found = allArtifacts.find((a) => a.id === compareBaselineId);
    return found ? found.content : artifact.content;
  }, [allArtifacts, artifact.content, compareBaselineId]);

  const diffLines = useMemo(() => {
    if (tab !== 'diff') return [];
    return computeLineDiff(baselineContent, editableContent);
  }, [baselineContent, editableContent, tab]);

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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card/90 px-3.5">
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3.5 py-2">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as 'preview' | 'code' | 'diff' | 'console');
            if (v !== 'preview') setInspectMode(false);
          }}
        >
          <TabsList>
            {canPreview && (
              <TabsTrigger value="preview" className="gap-1">
                <Eye className="h-3 w-3" />
                Preview
              </TabsTrigger>
            )}
            <TabsTrigger value="code" className="gap-1">
              <Code2 className="h-3 w-3" />
              IDE
            </TabsTrigger>
            <TabsTrigger value="diff" className="gap-1">
              <GitCompare className="h-3 w-3" />
              Diff
            </TabsTrigger>
            {(artifact.kind === 'html' || artifact.kind === 'svg') && (
              <TabsTrigger value="console" className="gap-1">
                <Terminal className="h-3 w-3" />
                <span className="hidden sm:inline">Console</span>
                {consoleLogs.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 text-[10px] text-primary">
                    {consoleLogs.length}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>

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
                <span>{inspectMode ? 'Pilih Elemen...' : 'Inspect'}</span>
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

      {/* Time-Machine Version Switcher */}
      {allArtifacts.length > 1 && (
        <div className="border-b bg-muted/20 px-3.5 py-1.5">
          <StudioScroll axis="x" autoHide="scroll" className="w-full">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Versions:
              </span>
              {allArtifacts.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectArtifact(item)}
                  className={cn(
                    'shrink-0 rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                    item.id === artifact.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/70 text-muted-foreground hover:text-foreground'
                  )}
                >
                  v{idx + 1}: {item.title}
                </button>
              ))}
            </div>
          </StudioScroll>
        </div>
      )}

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

      <div className="min-h-0 flex-1 overflow-hidden bg-muted/15">
        {tab === 'preview' && canPreview ? (
          artifact.kind === 'markdown' ? (
            <StudioScroll className="h-full w-full" autoHide="scroll">
              <div className="p-4 sm:p-6">
                <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-5 shadow-sm">
                  <MarkdownRenderer content={editableContent} />
                </div>
              </div>
            </StudioScroll>
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card/60 px-3.5 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Bandingkan dengan:</span>
                <select
                  value={compareBaselineId}
                  onChange={(e) => setCompareBaselineId(e.target.value)}
                  className="rounded-lg border bg-background px-2 py-1 text-xs outline-none"
                >
                  <option value="original">Asli Artifact Ini</option>
                  {allArtifacts.map((item, idx) =>
                    item.id === artifact.id ? null : (
                      <option key={item.id} value={item.id}>
                        v{idx + 1}: {item.title}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-emerald-400">+{diffStats.added}</span>
                <span className="text-rose-400">-{diffStats.removed}</span>
              </div>
            </div>

            <StudioScroll axis="both" autoHide="never" className="min-h-0 flex-1 bg-[#0b0d12]">
              <div className="min-w-full py-2 font-mono text-[12px] leading-6">
                {diffLines.map((d, idx) => (
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
            </StudioScroll>
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
            </StudioScroll>
          </div>
        ) : (
          <div className="h-full w-full overflow-hidden">
            <CodeMirror
              value={editableContent}
              height="100%"
              theme={oneDark}
              extensions={codeMirrorExtensions}
              onChange={(val) => {
                setEditableContent(val);
                setRuntimeError(null);
              }}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                autocompletion: true,
              }}
              className="h-full text-[13px]"
            />
          </div>
        )}
      </div>
    </div>
  );
}
