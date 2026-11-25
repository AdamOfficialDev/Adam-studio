import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  ArrowDown,
  ChevronDown,
  Code2,
  Cpu,
  Download,
  Eye,
  FileJson,
  FileText,
  FileUp,
  FolderGit2,
  GitBranch,
  Image as ImageIcon,
  Maximize2,
  Menu,
  Minimize2,
  MonitorDown,
  MoreVertical,
  Palette,
  Radio,
  Settings,
  Sparkles,
  Unlink,
  WifiOff,
  Workflow,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { ContextManagerDialog } from '@/components/ContextManagerDialog';
import { GitHubConnectorDialog } from '@/components/GitHubConnectorDialog';
import { ImportChatDialog } from '@/components/ImportChatDialog';
import { InstallAppDialog } from '@/components/InstallAppDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StudioScroll, type StudioScrollHandle } from '@/components/ui/studio-scroll';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArtifactPanel } from '@/components/ArtifactPanel';
import { WorkspacePanel } from '@/components/WorkspacePanel';
import {
  createEmptyWorkspace,
  removeWorkspaceFile,
  updateWorkspacePlan,
  upsertWorkspaceFile,
} from '@/lib/workspace';
import { BookmarksDialog } from '@/components/BookmarksDialog';
import { ChatComposer } from '@/components/ChatComposer';
import { StreamingChatMessage } from '@/components/StreamingChatMessage';
import {
  getActiveStreamSnapshot,
  setStreamState,
  useActiveStream,
  useIsStreamingActive,
  type ActiveStreamState,
} from '@/lib/streamStore';
import { CommandPalette } from '@/components/CommandPalette';
import { ModelSelectorDialog } from '@/components/ModelSelectorDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Sidebar } from '@/components/Sidebar';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { extractArtifactsFromMarkdown } from '@/lib/artifacts';
import {
  buildEffectiveApiHistory,
  estimateMessagesTokenTotal,
  runLosslessContextCompaction,
} from '@/lib/importer';
import { DEFAULT_MODEL_ID, getModelInfo, getModelThinkingCapabilities, resolveValidThinkingLevel } from '@/lib/models';
import { playCompletionChime } from '@/lib/sound';
import { streamChatCompletion } from '@/lib/sse';
import {
  hydrateConversationsWithMigration,
  syncConversationsToIdb,
} from '@/lib/db';
import {
  countApiKeys,
  loadSettings,
  saveSettings,
} from '@/lib/storage';
import { cn, estimateTokens, generateId } from '@/lib/utils';
import type {
  AppSettings,
  ArtifactItem,
  BuilderMode,
  EmergentPlan,
  Attachment,
  ChatMessage as ChatMessageType,
  CompactedContextState,
  Conversation,
  GitHubProjectContext,
  ServerHealth,
  ThemeSkin,
  TokenUsage,
  GroundingMetadataInfo,
  ToolTraceItem,
  VirtualWorkspace,
  VisualTarget,
} from '@/types/chat';

type WelcomeTab = 'All' | 'Coding' | 'UI/Design' | 'Agentic';

const WELCOME_TABS: WelcomeTab[] = ['All', 'Coding', 'UI/Design', 'Agentic'];

const STARTER_CARDS: Array<{
  category: Exclude<WelcomeTab, 'All'>;
  icon: typeof Code2;
  title: string;
  subtitle: string;
  prompt: string;
}> = [
  {
    category: 'UI/Design',
    icon: Code2,
    title: 'Interactive SaaS Dashboard',
    subtitle: 'HTML + CSS + JS lengkap siap uji Visual Inspector & Diff',
    prompt:
      'Buatkan dashboard analytics AI modern interaktif lengkap dengan chart SVG dan dark glassmorphism dalam satu blok ```html mandiri agar bisa langsung dilihat di Artifact Live Preview.',
  },
  {
    category: 'Agentic',
    icon: Workflow,
    title: 'Multi-Agent Code Reviewer',
    subtitle: 'Diagram arsitektur Mermaid + desain guardrails produksi',
    prompt:
      'Rancang sistem multi-agent AI untuk automated PR review beserta diagram arsitektur ```mermaid dan strategi fallback.',
  },
  {
    category: 'Coding',
    icon: Sparkles,
    title: 'High-Throughput SSE Server',
    subtitle: 'Zero-leak Node.js stream + backpressure & AbortController',
    prompt:
      'Buatkan implementasi server SSE (Server-Sent Events) TypeScript yang tahan memory leak, mendukung backpressure, heartbeat, dan graceful client abort.',
  },
  {
    category: 'UI/Design',
    icon: ImageIcon,
    title: 'Multimodal & Math Synthesis',
    subtitle: 'Visual diagram + formula matematis KaTeX terstruktur',
    prompt:
      'Jelaskan mekanisme multimodal cross-attention untuk teks dan gambar, lengkap dengan persamaan matematis $$\\text{Attention}(Q,K,V)$$ dan diagram ```mermaid.',
  },
];

const SKIN_ORDER: ThemeSkin[] = ['obsidian', 'claude', 'aurora', 'paper'];

function HeaderStreamBadge() {
  const stream = useActiveStream();
  if (!stream) return null;
  return (
    <Badge variant="outline" className="hidden font-mono text-[10px] sm:inline-flex">
      {stream.statusText
        ? 'Rotating Key...'
        : stream.tps > 0
          ? `${stream.tps} tok/s`
          : 'Thinking...'}
    </Badge>
  );
}

function StreamAutoScroller({
  viewport,
  autoScrollRef,
}: {
  viewport: HTMLElement | null;
  autoScrollRef: React.MutableRefObject<boolean>;
}) {
  const stream = useActiveStream();
  useEffect(() => {
    if (!stream || !autoScrollRef.current || !viewport) return;
    const raf = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [stream?.content, stream?.thought, viewport, autoScrollRef, stream]);
  return null;
}

function ScrollBottomPill({
  onScrollBottom,
}: {
  onScrollBottom: () => void;
}) {
  const stream = useActiveStream();
  return (
    <button
      type="button"
      onClick={onScrollBottom}
      className={cn(
        'absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-xl backdrop-blur-md transition-all hover:scale-105',
        stream
          ? 'border-primary/40 bg-card/95 text-foreground'
          : 'bg-secondary/95 text-secondary-foreground'
      )}
      aria-label="Scroll ke bawah"
    >
      {stream ? (
        <>
          <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
          <span>
            {stream.statusText
              ? 'Rotating Key...'
              : stream.tps > 0
                ? `Streaming ${stream.tps} tok/s`
                : 'Sedang Thinking...'}
          </span>
          <ArrowDown className="h-3.5 w-3.5 text-primary" />
        </>
      ) : (
        <ArrowDown className="h-4 w-4" />
      )}
    </button>
  );
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'new') return null;
    try {
      return localStorage.getItem('adam-studio-active-id');
    } catch {
      return null;
    }
  });
  const idbHydratedRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);

  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [activeArtifact, setActiveArtifact] = useState<ArtifactItem | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [draftBuilderMode, setDraftBuilderMode] = useState<BuilderMode>('chat');
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [artifactWidthPct, setArtifactWidthPct] = useState(46);
  const [isResizingPane, setIsResizingPane] = useState(false);

  const [welcomeTab, setWelcomeTab] = useState<WelcomeTab>('All');
  const [externalDraft, setExternalDraft] = useState<string | null>(null);
  const [visualTarget, setVisualTarget] = useState<VisualTarget | null>(null);
  const isStreamingActive = useIsStreamingActive();
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [scrollViewport, setScrollViewport] = useState<HTMLElement | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    setIsMobileViewport(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const { isStandalone, isIos, isOnline, canNativeInstall, triggerNativeInstall } = usePwaInstall();

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (needRefresh) {
      toast('Pembaruan Adam Studio tersedia', {
        description: 'Muat ulang untuk mendapatkan versi terbaru.',
        duration: 10000,
        action: {
          label: 'Update',
          onClick: () => {
            void updateServiceWorker(true);
          },
        },
      });
    }
  }, [needRefresh, updateServiceWorker]);

  const handleInstallAction = useCallback(async () => {
    if (canNativeInstall) {
      const result = await triggerNativeInstall();
      if (result === 'installed') {
        toast.success('Adam Studio berhasil diinstal!');
        return;
      }
      if (result === 'dismissed') return;
    }
    setInstallDialogOpen(true);
  }, [canNativeInstall, triggerNativeInstall]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<StudioScrollHandle | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const flushTimerRef = useRef<number | null>(null);

  // Muat & migrasi riwayat dari localStorage ke IndexedDB sekali saat startup
  useEffect(() => {
    let cancelled = false;
    void hydrateConversationsWithMigration().then((loaded) => {
      if (cancelled) return;
      idbHydratedRef.current = true;
      setConversations(loaded);

      const isNewShortcut = new URLSearchParams(window.location.search).get('action') === 'new';
      if (!isNewShortcut && loaded.length > 0) {
        setActiveId((prev) => {
          if (prev && loaded.some((c) => c.id === prev)) return prev;
          return loaded[0].id;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Simpan activeId ringan untuk restore tab terakhir saat reload
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem('adam-studio-active-id', activeId);
      else localStorage.removeItem('adam-studio-active-id');
    } catch {
      // Abaikan
    }
  }, [activeId]);

  // Sinkronisasi inkremental ke IndexedDB (hanya setelah hydration selesai)
  useEffect(() => {
    if (!idbHydratedRef.current) return;
    void syncConversationsToIdb(conversations);
  }, [conversations]);

  useEffect(() => {
    saveSettings(settings);
    document.documentElement.setAttribute('data-skin', settings.skin);
    if (settings.skin === 'paper') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, [settings]);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ServerHealth | null) => {
        if (data) setServerHealth(data);
      })
      .catch(() => {});
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  const messageList = activeConversation?.messages ?? [];
  const currentModelId = activeConversation?.model ?? selectedModel;
  const currentModelInfo = getModelInfo(currentModelId);
  const thinkingCaps = getModelThinkingCapabilities(currentModelId);
  const effectiveThinkingLevel = resolveValidThinkingLevel(
    currentModelId,
    settings.thinkingLevel
  );
  const thinkingEnabled =
    thinkingCaps.supported && settings.includeThoughts && effectiveThinkingLevel !== 'off';

  const activeKeyPoolCount =
    countApiKeys(settings.apiKey) ||
    serverHealth?.serverKeyCount ||
    (serverHealth?.hasServerApiKey ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: messageList.length,
    getScrollElement: () => scrollViewport,
    estimateSize: () => 180,
    overscan: 5,
    getItemKey: (index) => messageList[index]?.id ?? index,
  });

  const conversationArtifacts = useMemo(() => {
    if (!activeConversation) return [];
    const list: ArtifactItem[] = [];
    for (const msg of activeConversation.messages) {
      if (msg.role === 'assistant' && !msg.isStreaming && msg.content) {
        list.push(...extractArtifactsFromMarkdown(msg.id, msg.content));
      }
    }
    return list;
  }, [activeConversation]);

  const contextTokenEstimate = useMemo(() => {
    if (!activeConversation) return estimateTokens(settings.systemInstruction);
    const effective = buildEffectiveApiHistory(
      activeConversation.messages,
      activeConversation.compactedContext
    );
    const ghTokens = (activeConversation.githubProject?.pinnedFiles || []).reduce((s, f) => s + f.tokens, 0);
    return (
      estimateMessagesTokenTotal(effective) +
      ghTokens +
      estimateTokens(activeConversation.sessionSystemInstruction || settings.systemInstruction)
    );
  }, [activeConversation, settings.systemInstruction]);

  const contextUsagePct = Math.min(
    100,
    Math.max(1, Math.round((contextTokenEstimate / currentModelInfo.contextLimit) * 100))
  );

  const isContextOverFreeTier = contextTokenEstimate > 235_000;

  const scrollToBottom = useCallback(
    (smooth = false) => {
      const el = scrollViewport ?? chatScrollRef.current?.getViewport();
      if (!el) return;
      if (messageList.length > 0 && !smooth) {
        virtualizer.scrollToIndex(messageList.length - 1, { align: 'end' });
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      } else {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: smooth ? 'smooth' : 'auto',
        });
      }
    },
    [messageList.length, scrollViewport, virtualizer]
  );

  useEffect(() => {
    if (!activeId || messageList.length === 0 || !scrollViewport) return;
    autoScrollEnabledRef.current = true;
    setShowScrollBottom(false);
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(messageList.length - 1, { align: 'end' });
      requestAnimationFrame(() => {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      });
    });
  }, [activeId, scrollViewport]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoScrollEnabledRef.current && messageList.length > 0) {
      scrollToBottom(false);
    }
  }, [messageList.length, scrollToBottom]);

  const handleViewportScroll = useCallback((el: HTMLElement) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 95;
    autoScrollEnabledRef.current = nearBottom;
    setShowScrollBottom(!nearBottom);
  }, []);

  const handleStopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const current = getActiveStreamSnapshot();
    setStreamState(null);

    if (current) {
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id !== current.convId
            ? conv
            : {
                ...conv,
                updatedAt: Date.now(),
                messages: conv.messages.map((m) =>
                  m.id === current.msgId
                    ? {
                        ...m,
                        content: current.content,
                        thought: current.thought || m.thought,
                        toolEvents: current.toolEvents,
                        statusText: undefined,
                        usage: current.usage ?? m.usage,
                        metrics: current.thinkingDurationMs
                          ? { ...m.metrics, thinkingDurationMs: current.thinkingDurationMs }
                          : m.metrics,
                        isStreaming: false,
                        stopped: true,
                      }
                    : m
                ),
              }
        )
      );
    }
  }, []);

  const handleNewChat = useCallback(() => {
    if (isStreamingActive) handleStopStream();
    setActiveId(null);
    setActiveArtifact(null);
    setWorkspaceOpen(false);
    setArtifactFullscreen(false);
    setVisualTarget(null);
  }, [handleStopStream, isStreamingActive]);

  const handleCycleSkin = useCallback(() => {
    const idx = SKIN_ORDER.indexOf(settings.skin);
    const nextSkin = SKIN_ORDER[(idx + 1) % SKIN_ORDER.length];
    setSettings((prev) => ({ ...prev, skin: nextSkin }));
    toast.success(`Tema diganti ke ${nextSkin.toUpperCase()}`, {
      id: 'theme-skin-toast',
      duration: 2000,
    });
  }, [settings.skin]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        setZenMode((prev) => !prev);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNewChat]);

  const startResizingPane = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizingPane(true);

    const onMove = (moveEvent: PointerEvent) => {
      const widthPct = ((window.innerWidth - moveEvent.clientX) / window.innerWidth) * 100;
      setArtifactWidthPct(Math.min(66, Math.max(30, widthPct)));
    };

    const onUp = () => {
      setIsResizingPane(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const runStreamForConversation = useCallback(
    async (
      convId: string,
      modelId: string,
      historyMessages: ChatMessageType[],
      assistantMessageId: string,
      sessionSystemInstruction?: string,
      compactedContext?: CompactedContextState,
      githubProject?: GitHubProjectContext,
      continueMessage?: ChatMessageType,
      builderMode?: BuilderMode,
      workspace?: VirtualWorkspace
    ) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      autoScrollEnabledRef.current = true;

      const effectiveHistory = buildEffectiveApiHistory(historyMessages, compactedContext);
      const trimmedHistory =
        settings.maxHistoryMessages > 0 && effectiveHistory.length > settings.maxHistoryMessages
          ? effectiveHistory.slice(-settings.maxHistoryMessages)
          : effectiveHistory;

      const effectiveSystemInstruction = [
        settings.systemInstruction,
        sessionSystemInstruction ? `[Konteks Sistem Sesi Impor]\n${sessionSystemInstruction}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const startedAt = performance.now();
      let firstThoughtAt: number | null = null;
      let firstAnswerAt: number | null = null;
      let thinkingDurationMs: number | undefined = undefined;
      let accContent = continueMessage?.content ?? '';
      let accThought = continueMessage?.thought ?? '';
      let currentStatus: string | undefined = continueMessage
        ? 'Melanjutkan dari state terakhir...'
        : undefined;
      let accTools: ToolTraceItem[] = continueMessage?.toolEvents
        ? [...continueMessage.toolEvents]
        : [];
      let accUsage: TokenUsage | undefined = continueMessage?.usage;
      let accGrounding: GroundingMetadataInfo | undefined = continueMessage?.grounding;
      let chunkCount = 0;

      const continueFrom = continueMessage
        ? {
            partialContent: continueMessage.content || undefined,
            partialThought: continueMessage.thought || undefined,
            completedTools: continueMessage.toolEvents?.map((ev) => ({
              name: ev.name,
              argsSummary: ev.argsSummary,
              status: ev.status,
              resultSummary: ev.resultSummary,
            })),
          }
        : undefined;

      const initialStream: ActiveStreamState = {
        convId,
        msgId: assistantMessageId,
        content: accContent,
        thought: accThought,
        statusText: currentStatus,
        toolEvents: accTools.length > 0 ? [...accTools] : undefined,
        tps: 0,
        usage: accUsage,
        grounding: accGrounding,
      };
      setStreamState(initialStream);

      const commitStreamSnapshot = () => {
        flushTimerRef.current = null;
        if (!getActiveStreamSnapshot()) return;
        const elapsed = Math.max(100, performance.now() - (firstAnswerAt ?? startedAt));
        const estTok = Math.max(chunkCount, Math.round(accContent.length / 4));
        const tps = firstAnswerAt ? Number(((estTok / elapsed) * 1000).toFixed(1)) : 0;
        const snapshot: ActiveStreamState = {
          convId,
          msgId: assistantMessageId,
          content: accContent,
          thought: accThought,
          statusText: currentStatus,
          toolEvents: accTools.length > 0 ? [...accTools] : undefined,
          tps,
          thinkingDurationMs,
          usage: accUsage,
        };
        setStreamState(snapshot);
      };

      const scheduleFlush = () => {
        if (flushTimerRef.current !== null) return;
        const cadence = accContent.length > 2500 ? 65 : 35;
        flushTimerRef.current = window.setTimeout(commitStreamSnapshot, cadence);
      };

      try {
        let activeGithubProject = githubProject;
        if (activeGithubProject && !settings.demoMode) {
          currentStatus = `Mengecek commit terbaru ${activeGithubProject.owner}/${activeGithubProject.repo}...`;
          commitStreamSnapshot();
          try {
            const ghHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (settings.githubToken?.trim()) {
              ghHeaders['x-github-token'] = settings.githubToken.trim();
            }
            const syncRes = await fetch('/api/github', {
              method: 'POST',
              headers: ghHeaders,
              body: JSON.stringify({
                action: 'sync-project',
                owner: activeGithubProject.owner,
                repo: activeGithubProject.repo,
                branch: activeGithubProject.branch,
                currentCommitSha: activeGithubProject.commitSha,
                pinnedPaths: activeGithubProject.pinnedFiles.map((f) => f.path),
              }),
              signal: controller.signal,
            });
            if (syncRes.ok) {
              const syncData = (await syncRes.json()) as {
                ok?: boolean;
                updated?: boolean;
                commitSha?: string;
                totalFiles?: number;
                treePaths?: string[];
                pinnedFiles?: GitHubProjectContext['pinnedFiles'];
              };
              if (syncData.ok && syncData.updated) {
                activeGithubProject = {
                  ...activeGithubProject,
                  commitSha: syncData.commitSha ?? activeGithubProject.commitSha,
                  totalFiles: syncData.totalFiles ?? activeGithubProject.totalFiles,
                  treePaths: syncData.treePaths ?? activeGithubProject.treePaths,
                  pinnedFiles: syncData.pinnedFiles ?? activeGithubProject.pinnedFiles,
                  lastSyncedAt: Date.now(),
                };
                setConversations((prev) =>
                  prev.map((conv) =>
                    conv.id !== convId ? conv : { ...conv, githubProject: activeGithubProject }
                  )
                );
                toast.success('Repo tersinkron ke commit terbaru', {
                  description: activeGithubProject.commitSha
                    ? `${activeGithubProject.owner}/${activeGithubProject.repo} @ ${activeGithubProject.commitSha.slice(0, 7)}`
                    : `${activeGithubProject.owner}/${activeGithubProject.repo}`,
                });
              } else if (syncData.ok && syncData.commitSha && !activeGithubProject.commitSha) {
                activeGithubProject = {
                  ...activeGithubProject,
                  commitSha: syncData.commitSha,
                  lastSyncedAt: Date.now(),
                };
                setConversations((prev) =>
                  prev.map((conv) =>
                    conv.id !== convId ? conv : { ...conv, githubProject: activeGithubProject }
                  )
                );
              }
            }
          } catch (syncErr) {
            if (syncErr instanceof Error && syncErr.name === 'AbortError') {
              throw syncErr;
            }
          } finally {
            currentStatus = continueMessage ? 'Melanjutkan dari state terakhir...' : undefined;
            commitStreamSnapshot();
          }
        }

        let finalHistoryForApi = trimmedHistory;
        const estimatedTextBytes = finalHistoryForApi.reduce(
          (sum, m) =>
            sum +
            (m.content?.length || 0) +
            (m.visualTarget?.outerHtml?.length || 0) +
            (m.attachments || []).reduce((aSum, a) => aSum + (a.textContent?.length || 0), 0),
          0
        );

        if (
          !settings.demoMode &&
          !continueMessage &&
          historyMessages.length > 6 &&
          estimatedTextBytes > 2_600_000
        ) {
          const keepRecent = 6;
          const prevKept =
            compactedContext?.mode === 'ai-summary'
              ? Math.max(keepRecent, compactedContext.keepRecentCount)
              : historyMessages.length;
          const messagesToDistill =
            compactedContext?.mode === 'ai-summary' && historyMessages.length > prevKept
              ? historyMessages.slice(-prevKept)
              : historyMessages;

          if (messagesToDistill.length > keepRecent) {
            currentStatus =
              'Menjaga 100% konteks dari awal sesi (Auto-Compacting riwayat lama)...';
            commitStreamSnapshot();

            const compactRes = await runLosslessContextCompaction({
              messages: messagesToDistill,
              keepRecentCount: keepRecent,
              model: modelId,
              apiKey: settings.apiKey,
              existingSummary:
                compactedContext?.mode === 'ai-summary'
                  ? compactedContext.summaryPrefix
                  : undefined,
              signal: controller.signal,
              onStatus: (msg) => {
                currentStatus = msg;
                commitStreamSnapshot();
              },
            });

            if (compactRes.ok && compactRes.summary) {
              const nextCompactedState: CompactedContextState = {
                mode: 'ai-summary',
                summaryPrefix: compactRes.summary,
                keepRecentCount: keepRecent,
                estimatedTokens: estimateMessagesTokenTotal(
                  buildEffectiveApiHistory(historyMessages, {
                    mode: 'ai-summary',
                    summaryPrefix: compactRes.summary,
                    keepRecentCount: keepRecent,
                    estimatedTokens: 0,
                    updatedAt: Date.now(),
                  })
                ),
                updatedAt: Date.now(),
              };

              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id !== convId
                    ? conv
                    : { ...conv, compactedContext: nextCompactedState }
                )
              );

              finalHistoryForApi = buildEffectiveApiHistory(
                historyMessages,
                nextCompactedState
              );
              toast.success('Konteks awal sesi diringkas lossless agar muat batas server.');
            }
          }
        }

        await streamChatCompletion(
          {
            model: modelId,
            messages: finalHistoryForApi.map((m) => ({
              role: m.role,
              content: m.content,
              visualTarget: m.visualTarget,
              attachments: m.attachments,
            })),
            githubProject: activeGithubProject,
            githubToken: settings.githubToken,
            daytonaApiKey: settings.daytonaApiKey,
            daytonaApiUrl: settings.daytonaApiUrl,
            builderMode: builderMode || 'chat',
            workspace,
            systemInstruction: effectiveSystemInstruction,
            maxOutputTokens: settings.maxOutputTokens,
            includeThoughts: settings.includeThoughts,
            thinkingLevel: resolveValidThinkingLevel(modelId, settings.thinkingLevel),
            enableGoogleSearch: settings.enableGoogleSearch,
            enableUrlContext: settings.enableUrlContext,
            autoFallbackOnOverload: settings.autoFallbackOnOverload,
            fallbackModel: settings.fallbackModel,
            demoMode: settings.demoMode,
            apiKey: settings.apiKey,
            continueFrom,
          },
          {
            signal: controller.signal,
            onWorkspacePlan: (plan: EmergentPlan) => {
              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id !== convId
                    ? conv
                    : {
                        ...conv,
                        workspace: updateWorkspacePlan(conv.workspace, plan),
                        updatedAt: Date.now(),
                      }
                )
              );
            },
            onWorkspaceSandbox: (evt) => {
              setConversations((prev) =>
                prev.map((conv) => {
                  if (conv.id !== convId) return conv;
                  const baseWs = conv.workspace || createEmptyWorkspace();
                  return {
                    ...conv,
                    workspace: {
                      ...baseWs,
                      daytonaSandboxId: evt.sandboxId || baseWs.daytonaSandboxId,
                      daytonaPreviewUrl: evt.previewUrl ?? baseWs.daytonaPreviewUrl,
                      daytonaPreviewToken: evt.previewToken ?? baseWs.daytonaPreviewToken,
                      updatedAt: Date.now(),
                    },
                    updatedAt: Date.now(),
                  };
                })
              );
              setWorkspaceOpen(true);
            },
            onWorkspaceFile: (evt) => {
              setConversations((prev) =>
                prev.map((conv) => {
                  if (conv.id !== convId) return conv;
                  const nextWs =
                    evt.action === 'delete'
                      ? removeWorkspaceFile(conv.workspace, evt.path)
                      : upsertWorkspaceFile(conv.workspace, evt.path, evt.content || '');
                  return { ...conv, workspace: nextWs, updatedAt: Date.now() };
                })
              );
              if (evt.action === 'write') {
                setActiveArtifact(null);
                setWorkspaceOpen(true);
              }
            },
            onToolCall: (item) => {
              currentStatus = undefined;
              accTools = [...accTools, item];
              commitStreamSnapshot();
            },
            onToolResult: (item) => {
              accTools = accTools.map((t) => (t.id === item.id ? item : t));
              commitStreamSnapshot();
            },
            onStatus: (statusMessage) => {
              currentStatus = statusMessage;
              commitStreamSnapshot();
            },
            onThought: (thoughtChunk) => {
              currentStatus = undefined;
              if (firstThoughtAt === null) firstThoughtAt = performance.now();
              if (continueMessage?.thought && accThought === continueMessage.thought) {
                accThought += '\n\n';
              }
              accThought += thoughtChunk;
              scheduleFlush();
            },
            onDelta: (textChunk) => {
              currentStatus = undefined;
              if (firstAnswerAt === null) {
                firstAnswerAt = performance.now();
                const thinkOrigin = firstThoughtAt ?? startedAt;
                thinkingDurationMs = Math.max(100, Math.round(firstAnswerAt - thinkOrigin));
              }
              accContent += textChunk;
              chunkCount += 1;
              scheduleFlush();
            },
            onUsage: (usage) => {
              accUsage = usage;
            },
            onGrounding: (grounding) => {
              const prevSources = accGrounding?.sources || [];
              const nextSources = grounding.sources || [];
              const mergedMap = new Map<string, { title?: string; uri: string }>();
              for (const s of [...prevSources, ...nextSources]) {
                if (s?.uri) mergedMap.set(s.uri, s);
              }
              const prevUrls = accGrounding?.urlContexts || [];
              const nextUrls = grounding.urlContexts || [];
              const urlMap = new Map<string, { url: string; status?: string }>();
              for (const u of [...prevUrls, ...nextUrls]) {
                if (u?.url) urlMap.set(u.url, u);
              }
              const mergedQueries = Array.from(
                new Set([
                  ...(accGrounding?.webSearchQueries || []),
                  ...(grounding.webSearchQueries || []),
                ])
              );
              accGrounding = {
                webSearchQueries: mergedQueries.length > 0 ? mergedQueries : undefined,
                sources: mergedMap.size > 0 ? Array.from(mergedMap.values()) : undefined,
                urlContexts: urlMap.size > 0 ? Array.from(urlMap.values()) : undefined,
              };
              scheduleFlush();
            },
            onInfo: (infoMsg) => {
              toast.info(infoMsg);
            },
            onDone: ({ model: resolvedModel, isDemo }) => {
              if (flushTimerRef.current !== null) {
                window.clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              setStreamState(null);

              const finishedAt = performance.now();
              const durationMs = Math.max(1, Math.round(finishedAt - startedAt));
              const firstAny = firstAnswerAt ?? firstThoughtAt;
              const ttftMs = firstAny !== null ? Math.round(firstAny - startedAt) : durationMs;

              if (thinkingDurationMs === undefined && accThought) {
                thinkingDurationMs = Math.max(
                  100,
                  Math.round(finishedAt - (firstThoughtAt ?? startedAt))
                );
              }

              const answerWindow = Math.max(1, finishedAt - (firstAnswerAt ?? startedAt));
              const estTokens = Math.max(chunkCount, Math.round(accContent.length / 4));
              const tokensPerSec = Number(((estTokens / answerWindow) * 1000).toFixed(1));

              if (settings.soundChime && durationMs >= 2500) {
                playCompletionChime();
              }

              const emptyReplyError =
                accContent.trim().length === 0
                  ? 'Model selesai tanpa teks jawaban. Silakan klik Regenerate atau aktifkan Auto-Fallback di Settings.'
                  : undefined;

              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id !== convId
                    ? conv
                    : {
                        ...conv,
                        updatedAt: Date.now(),
                        messages: conv.messages.map((m) =>
                          m.id === assistantMessageId
                            ? {
                                ...m,
                                model: resolvedModel || m.model,
                                content: accContent,
                                thought: accThought || undefined,
                                toolEvents: accTools.length > 0 ? accTools : undefined,
                                statusText: undefined,
                                usage: accUsage,
                                isStreaming: false,
                                stopped: undefined,
                                isDemo,
                                error: emptyReplyError,
                                metrics: {
                                  ttftMs,
                                  thinkingDurationMs,
                                  durationMs,
                                  tokensPerSec,
                                },
                              }
                            : m
                        ),
                      }
                )
              );

              if (settings.autoOpenArtifacts && accContent) {
                const detected = extractArtifactsFromMarkdown(assistantMessageId, accContent);
                const previewable = detected.find(
                  (a) => a.kind === 'html' || a.kind === 'svg' || a.kind === 'mermaid'
                );
                if (previewable) setActiveArtifact(previewable);
              }
            },
            onError: (errorMessage) => {
              if (flushTimerRef.current !== null) {
                window.clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              setStreamState(null);
              toast.error(errorMessage);
              setConversations((prev) =>
                prev.map((conv) =>
                  conv.id !== convId
                    ? conv
                    : {
                        ...conv,
                        messages: conv.messages.map((m) =>
                          m.id === assistantMessageId
                            ? {
                                ...m,
                                content: accContent,
                                thought: accThought || undefined,
                                toolEvents: accTools.length > 0 ? accTools : undefined,
                                statusText: undefined,
                                usage: accUsage,
                                isStreaming: false,
                                error: errorMessage,
                              }
                            : m
                        ),
                      }
                )
              );
            },
          }
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Gagal terhubung ke server SSE.';
        toast.error(message);
        setStreamState(null);
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id !== convId
              ? conv
              : {
                  ...conv,
                  messages: conv.messages.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          content: accContent,
                          thought: accThought || undefined,
                          toolEvents: accTools.length > 0 ? accTools : undefined,
                          statusText: undefined,
                          usage: accUsage,
                          isStreaming: false,
                          error: message,
                        }
                      : m
                  ),
                }
          )
        );
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          if (getActiveStreamSnapshot()?.msgId === assistantMessageId) {
            setStreamState(null);
            setConversations((prev) =>
              prev.map((conv) =>
                conv.id !== convId
                  ? conv
                  : {
                      ...conv,
                      messages: conv.messages.map((m) =>
                        m.id === assistantMessageId && m.isStreaming
                          ? {
                              ...m,
                              content: accContent,
                              thought: accThought || undefined,
                              statusText: undefined,
                              isStreaming: false,
                            }
                          : m
                      ),
                    }
              )
            );
          }
        }
      }
    },
    [settings]
  );

  const handleSend = useCallback(
    (text: string, attachments: Attachment[]) => {
      if (isStreamingActive) return;

      const currentVisualTarget = visualTarget;
      setVisualTarget(null);

      const userMessage: ChatMessageType = {
        id: generateId(),
        role: 'user',
        content: text,
        visualTarget: currentVisualTarget || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: Date.now(),
      };

      const assistantMessageId = generateId();
      const assistantPlaceholder: ChatMessageType = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        model: currentModelId,
        isStreaming: true,
      };

      if (!activeConversation) {
        const newId = generateId();
        const title = (text || attachments[0]?.name || 'New Chat').slice(0, 50);
        const newConv: Conversation = {
          id: newId,
          title,
          model: currentModelId,
          builderMode: draftBuilderMode,
          messages: [userMessage, assistantPlaceholder],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        setConversations((prev) => [newConv, ...prev]);
        setActiveId(newId);
        void runStreamForConversation(
          newId,
          currentModelId,
          [userMessage],
          assistantMessageId,
          undefined,
          undefined,
          undefined,
          undefined,
          draftBuilderMode,
          undefined
        );
      } else {
        const historyForModel = [...activeConversation.messages, userMessage];
        const nextCompacted: CompactedContextState | undefined = activeConversation.compactedContext
          ? activeConversation.compactedContext.mode === 'ai-summary'
            ? {
                ...activeConversation.compactedContext,
                keepRecentCount: activeConversation.compactedContext.keepRecentCount + 2,
              }
            : activeConversation.compactedContext
          : undefined;

        setConversations((prev) =>
          prev.map((conv) =>
            conv.id !== activeConversation.id
              ? conv
              : {
                  ...conv,
                  compactedContext: nextCompacted,
                  updatedAt: Date.now(),
                  messages: [...conv.messages, userMessage, assistantPlaceholder],
                }
          )
        );
        void runStreamForConversation(
          activeConversation.id,
          currentModelId,
          historyForModel,
          assistantMessageId,
          activeConversation.sessionSystemInstruction,
          nextCompacted,
          activeConversation.githubProject,
          undefined,
          activeConversation.builderMode || 'chat',
          activeConversation.workspace
        );
      }
    },
    [activeConversation, currentModelId, isStreamingActive, runStreamForConversation, visualTarget]
  );

  const handleContinue = useCallback(() => {
    if (!activeConversation || isStreamingActive) return;
    const msgs = activeConversation.messages;
    if (msgs.length === 0) return;

    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role !== 'assistant') return;

    const baseMessages = msgs.slice(0, -1);
    if (baseMessages.length === 0) return;

    const targetModel = lastMsg.model || activeConversation.model;
    const resumableSnapshot: ChatMessageType = { ...lastMsg };

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id !== activeConversation.id
          ? conv
          : {
              ...conv,
              updatedAt: Date.now(),
              messages: conv.messages.map((m) =>
                m.id === lastMsg.id
                  ? {
                      ...m,
                      error: undefined,
                      stopped: undefined,
                      isStreaming: true,
                      statusText: 'Melanjutkan dari state terakhir...',
                    }
                  : m
              ),
            }
      )
    );

    void runStreamForConversation(
      activeConversation.id,
      targetModel,
      baseMessages,
      lastMsg.id,
      activeConversation.sessionSystemInstruction,
      activeConversation.compactedContext,
      activeConversation.githubProject,
      resumableSnapshot,
      activeConversation.builderMode || 'chat',
      activeConversation.workspace
    );
  }, [activeConversation, isStreamingActive, runStreamForConversation]);

  const handleRegenerate = useCallback(
    (overrideModel?: string) => {
      if (!activeConversation || isStreamingActive) return;
      const msgs = activeConversation.messages;
      if (msgs.length === 0) return;

      const lastMsg = msgs[msgs.length - 1];
      const baseMessages = lastMsg.role === 'assistant' ? msgs.slice(0, -1) : msgs;
      if (baseMessages.length === 0) return;

      const targetModel = overrideModel || activeConversation.model;
      const assistantMessageId = generateId();
      const assistantPlaceholder: ChatMessageType = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        model: targetModel,
        isStreaming: true,
      };

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id !== activeConversation.id
            ? conv
            : {
                ...conv,
                model: targetModel,
                updatedAt: Date.now(),
                messages: [...baseMessages, assistantPlaceholder],
              }
        )
      );

      void runStreamForConversation(
        activeConversation.id,
        targetModel,
        baseMessages,
        assistantMessageId,
        activeConversation.sessionSystemInstruction,
        activeConversation.compactedContext,
        activeConversation.githubProject,
        undefined,
        activeConversation.builderMode || 'chat',
        activeConversation.workspace
      );
    },
    [activeConversation, isStreamingActive, runStreamForConversation]
  );

  const handleEditUserMessage = useCallback(
    (messageId: string, newContent: string) => {
      if (!activeConversation || isStreamingActive) return;
      const idx = activeConversation.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const updatedMsg: ChatMessageType = {
        ...activeConversation.messages[idx],
        content: newContent,
      };
      const baseHistory = [...activeConversation.messages.slice(0, idx), updatedMsg];

      const assistantMessageId = generateId();
      const assistantPlaceholder: ChatMessageType = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        model: activeConversation.model,
        isStreaming: true,
      };

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id !== activeConversation.id
            ? conv
            : {
                ...conv,
                updatedAt: Date.now(),
                messages: [...baseHistory, assistantPlaceholder],
              }
        )
      );

      void runStreamForConversation(
        activeConversation.id,
        activeConversation.model,
        baseHistory,
        assistantMessageId,
        activeConversation.sessionSystemInstruction,
        activeConversation.compactedContext,
        activeConversation.githubProject
      );
    },
    [activeConversation, isStreamingActive, runStreamForConversation]
  );

  const handleForkFromMessage = useCallback(
    (messageId: string) => {
      if (!activeConversation) return;
      const idx = activeConversation.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const forkedId = generateId();
      const forkedConv: Conversation = {
        id: forkedId,
        title: `Branch: ${activeConversation.title}`.slice(0, 52),
        model: activeConversation.model,
        sessionSystemInstruction: activeConversation.sessionSystemInstruction,
        githubProject: activeConversation.githubProject,
        compactedContext: activeConversation.compactedContext,
        messages: activeConversation.messages.slice(0, idx + 1).map((m) => ({
          ...m,
          id: generateId(),
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversations((prev) => [forkedConv, ...prev]);
      setActiveId(forkedId);
      toast.success('Cabang chat baru dibuat');
    },
    [activeConversation]
  );

  const handleConfirmImport = useCallback(
    (payload: {
      mode: 'new' | 'append';
      title: string;
      model: string;
      sessionSystemInstruction?: string;
      sourceLabel?: string;
      compactedContext?: CompactedContextState;
      messages: ChatMessageType[];
    }) => {
      if (isStreamingActive) handleStopStream();

      if (payload.mode === 'append' && activeConversation) {
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id !== activeConversation.id
              ? conv
              : {
                  ...conv,
                  updatedAt: Date.now(),
                  sessionSystemInstruction:
                    payload.sessionSystemInstruction || conv.sessionSystemInstruction,
                  compactedContext: payload.compactedContext || conv.compactedContext,
                  messages: [...conv.messages, ...payload.messages],
                }
          )
        );
        toast.success(`${payload.messages.length} pesan digabungkan ke sesi aktif!`);
      } else {
        const newId = generateId();
        const newConv: Conversation = {
          id: newId,
          title: payload.title,
          model: payload.model || selectedModel,
          sessionSystemInstruction: payload.sessionSystemInstruction,
          importedSource: payload.sourceLabel,
          compactedContext: payload.compactedContext,
          messages: payload.messages,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setConversations((prev) => [newConv, ...prev]);
        setActiveId(newId);
        setActiveArtifact(null);
        setArtifactFullscreen(false);
        toast.success(
          `Berhasil impor ${payload.messages.length} pesan (${payload.sourceLabel || 'Konteks'}). Silakan lanjutkan chat!`
        );
      }
    },
    [activeConversation, handleStopStream, isStreamingActive, selectedModel]
  );

  const handleAttachGitHubProject = useCallback(
    (project: GitHubProjectContext) => {
      if (activeConversation) {
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id !== activeConversation.id
              ? conv
              : { ...conv, githubProject: project, updatedAt: Date.now() }
          )
        );
        toast.success(`Project ${project.owner}/${project.repo} terpasang di sesi ini!`);
      } else {
        const newId = generateId();
        const welcomeAssistant: ChatMessageType = {
          id: generateId(),
          role: 'assistant',
          model: selectedModel,
          createdAt: Date.now(),
          content: `Project GitHub **\`${project.owner}/${project.repo}\`** (branch \`${project.branch}\`, **${project.totalFiles} file**) sudah terhubung ke sesi ini!\n\nKamu bisa langsung bertanya, menambah fitur, memperbaiki error, atau meningkatkan UI/UX repo ini.`,
        };
        setConversations((prev) => [
          {
            id: newId,
            title: `Repo: ${project.repo}`.slice(0, 48),
            model: selectedModel,
            githubProject: project,
            messages: [welcomeAssistant],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ...prev,
        ]);
        setActiveId(newId);
        toast.success(`Sesi Project ${project.owner}/${project.repo} siap!`);
      }
    },
    [activeConversation, selectedModel]
  );

  const handleDetachGitHubProject = useCallback(() => {
    if (!activeConversation) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConversation.id ? { ...c, githubProject: undefined } : c))
    );
    toast.success('Repository dilepas dari sesi ini');
  }, [activeConversation]);

  const handleUpdateGithubToken = useCallback((tk: string) => {
    setSettings((prev) => ({ ...prev, githubToken: tk }));
  }, []);

  const handleApplyCompaction = useCallback(
    (convId: string, compacted?: CompactedContextState) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, compactedContext: compacted } : c))
      );
    },
    []
  );

  const handleToggleStar = useCallback((convId: string, msgId: string) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id !== convId
          ? conv
          : {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === msgId ? { ...m, starred: !m.starred } : m
              ),
            }
      )
    );
  }, []);

  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    if (activeConversation) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, model: modelId } : c))
      );
    }
    toast.success(`Model aktif: ${modelId}`);
  };

  const handleExportConversation = useCallback(
    (format: 'md' | 'json') => {
      if (!activeConversation) {
        toast.error('Tidak ada percakapan aktif untuk di-export');
        return;
      }
      let content = '';
      let mime = 'text/markdown;charset=utf-8';
      if (format === 'json') {
        content = JSON.stringify(activeConversation, null, 2);
        mime = 'application/json;charset=utf-8';
      } else {
        content = [
          `# ${activeConversation.title}`,
          `Model: \`${activeConversation.model}\`\n`,
          ...activeConversation.messages.map(
            (m) => `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}\n`
          ),
        ].join('\n');
      }
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${activeConversation.id.slice(0, 8)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported .${format}`);
    },
    [activeConversation]
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      if (getActiveStreamSnapshot()?.convId === id) handleStopStream();
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      });
      toast.success('Percakapan dihapus');
    },
    [activeId, handleStopStream]
  );

  const handleRenameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const handleTogglePinConversation = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  }, []);

  const handleContinueLatest = useCallback(() => handleContinue(), [handleContinue]);
  const handleRegenerateLatest = useCallback(() => handleRegenerate(), [handleRegenerate]);
  const handleRetryWithModel = useCallback((mId: string) => handleRegenerate(mId), [handleRegenerate]);
  const handleToggleMessageStar = useCallback(
    (msgId: string) => {
      if (activeId) handleToggleStar(activeId, msgId);
    },
    [activeId, handleToggleStar]
  );
  const handleJumpBottom = useCallback(() => {
    autoScrollEnabledRef.current = true;
    scrollToBottom(true);
  }, [scrollToBottom]);
  const handleClearExternalDraft = useCallback(() => setExternalDraft(null), []);
  const handleClearVisualTarget = useCallback(() => setVisualTarget(null), []);
  const handleToggleArtifactFs = useCallback(() => setArtifactFullscreen((f) => !f), []);
  const handleCloseArtifact = useCallback(() => {
    setActiveArtifact(null);
    setArtifactFullscreen(false);
  }, []);
  const handleSelectVisualTarget = useCallback((target: VisualTarget) => {
    setVisualTarget(target);
    if (window.innerWidth < 1024) {
      setActiveArtifact(null);
      setArtifactFullscreen(false);
    }
  }, []);
  const handleInsertToChat = useCallback((snippet: string) => {
    setExternalDraft(snippet);
    if (window.innerWidth < 1024) {
      setActiveArtifact(null);
      setArtifactFullscreen(false);
    }
  }, []);
  const handleFixErrorWithAi = useCallback(
    (errMsg: string, art: ArtifactItem) => {
      handleSend(
        `Terjadi error runtime saat menjalankan Preview pada \`${art.title}\`:\n\`\`\`\n${errMsg}\n\`\`\`\nTolong perbaiki bug tersebut secara lengkap.`,
        []
      );
      if (window.innerWidth < 1024) {
        setActiveArtifact(null);
        setArtifactFullscreen(false);
      }
    },
    [handleSend]
  );

  const lastAssistantId = useMemo(() => {
    for (let i = messageList.length - 1; i >= 0; i--) {
      if (messageList[i].role === 'assistant') return messageList[i].id;
    }
    return null;
  }, [messageList]);

  const filteredStarterCards = useMemo(() => {
    if (welcomeTab === 'All') return STARTER_CARDS;
    return STARTER_CARDS.filter((c) => c.category === welcomeTab);
  }, [welcomeTab]);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Toaster
        position={isMobileViewport ? 'top-center' : 'top-right'}
        theme={settings.skin === 'paper' ? 'light' : 'dark'}
        closeButton
        visibleToasts={isMobileViewport ? 1 : 3}
        gap={8}
        duration={3200}
        offset={isMobileViewport ? 58 : 64}
        toastOptions={{
          className: 'adam-toast',
        }}
      />

        <div className="flex h-[100dvh] w-full max-w-full overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Sidebar
              open={sidebarOpen}
              mobileOpen={mobileSidebarOpen}
              onToggleDesktop={() => setSidebarOpen((prev) => !prev)}
              onCloseMobile={() => setMobileSidebarOpen(false)}
              conversations={conversations}
              activeId={activeId}
              onNewChat={handleNewChat}
              onImportChat={() => setImportDialogOpen(true)}
              onSelectConversation={(id) => {
                if (isStreamingActive) handleStopStream();
                setActiveId(id);
                setActiveArtifact(null);
                setArtifactFullscreen(false);
                setVisualTarget(null);
              }}
              onRenameConversation={handleRenameConversation}
              onTogglePinConversation={handleTogglePinConversation}
              onDeleteConversation={handleDeleteConversation}
              onOpenSettings={() => setSettingsDialogOpen(true)}
              onOpenCommandPalette={() => setCommandOpen(true)}
              onOpenBookmarks={() => setBookmarksOpen(true)}
              onCycleSkin={handleCycleSkin}
              showInstallButton={!isStandalone}
              onInstallApp={() => void handleInstallAction()}
            />
          )}

          <div
            className={cn(
              'flex min-w-0 max-w-full flex-1 flex-col overflow-hidden',
              activeArtifact && artifactFullscreen && 'hidden lg:hidden'
            )}
          >
            <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/95 px-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                {!zenMode && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileSidebarOpen(true)}
                    className="shrink-0 md:hidden"
                    aria-label="Menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setModelDialogOpen(true)}
                  className="h-9 min-w-0 gap-1.5 rounded-xl border border-border/50 bg-card/60 px-2.5 font-medium shadow-sm sm:gap-2 sm:px-3"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-xs sm:text-sm">{currentModelInfo.name}</span>
                  {currentModelInfo.isNew && (
                    <Badge
                      variant="secondary"
                      className="hidden bg-emerald-500/15 text-[10px] text-emerald-500 sm:inline-flex"
                    >
                      New
                    </Badge>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button>

                <HeaderStreamBadge />
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {!isOnline && (
                  <Badge variant="destructive" className="gap-1 px-2 py-0.5 text-[10px]">
                    <WifiOff className="h-3 w-3" />
                    <span className="hidden sm:inline">Offline</span>
                  </Badge>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={activeConversation?.githubProject ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setGithubDialogOpen(true)}
                      className={cn(
                        'h-8 gap-1.5 rounded-full border px-2.5 text-xs',
                        activeConversation?.githubProject
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/60 bg-card/60 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <FolderGit2 className="h-3.5 w-3.5 text-primary" />
                      <span className="hidden max-w-[100px] truncate sm:inline">
                        {activeConversation?.githubProject ? activeConversation.githubProject.repo : 'GitHub'}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Hubungkan Repository GitHub ke Sesi Ini</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setImportDialogOpen(true)}
                      className="h-8 gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <FileUp className="h-3.5 w-3.5 text-primary" />
                      <span className="hidden sm:inline">Import Chat</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Impor history chat (.json / .md) sebagai konteks sesi ini
                  </TooltipContent>
                </Tooltip>

                {/* Context Meter Pill — Klik untuk buka Context Window Manager (Kompres <250k Free Tier) */}
                {activeConversation && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setContextDialogOpen(true)}
                        className={cn(
                          'flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                          isContextOverFreeTier
                            ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                            : activeConversation.compactedContext
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                              : 'bg-card/60 text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                      >
                        <span className="font-mono">
                          {(contextTokenEstimate / 1000).toFixed(1)}k ctx
                        </span>
                        <div className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-muted sm:block">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              isContextOverFreeTier ? 'bg-amber-400' : 'bg-primary'
                            )}
                            style={{ width: `${contextUsagePct}%` }}
                          />
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isContextOverFreeTier
                        ? 'Melebihi batas Free Tier 250k TPM! Klik untuk ringkas / kompres konteks.'
                        : activeConversation.compactedContext
                          ? 'Konteks dioptimalkan untuk API. Klik untuk kelola.'
                          : `Estimasi context (~${contextTokenEstimate.toLocaleString()} tok). Klik untuk kelola.`}
                    </TooltipContent>
                  </Tooltip>
                )}

                {conversationArtifacts.length > 0 && !activeArtifact && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setActiveArtifact(conversationArtifacts[conversationArtifacts.length - 1])
                    }
                    className="h-8 gap-1 rounded-full px-2.5 text-xs"
                  >
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    <span className="hidden sm:inline">
                      Canvas ({conversationArtifacts.length})
                    </span>
                  </Button>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setSettingsDialogOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-2.5"
                    >
                      <Radio
                        className={
                          settings.demoMode
                            ? 'h-3.5 w-3.5 text-amber-500'
                            : 'h-3.5 w-3.5 text-emerald-500'
                        }
                      />
                      <span className="hidden sm:inline">
                        {settings.demoMode
                          ? 'Demo SSE'
                          : activeKeyPoolCount > 1
                            ? `${activeKeyPoolCount} Keys`
                            : 'Live SSE'}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {settings.demoMode
                      ? 'Mode simulasi SSE lokal aktif'
                      : activeKeyPoolCount > 1
                        ? `Auto-Rotation Pool aktif (${activeKeyPoolCount} API keys)`
                        : 'Streaming SSE ke /api/chat'}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={zenMode ? 'secondary' : 'ghost'}
                      size="icon"
                      onClick={() => setZenMode((z) => !z)}
                      className="hidden sm:inline-flex"
                    >
                      {zenMode ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Zen Focus Mode (Ctrl+\)</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="Menu studio">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setImportDialogOpen(true)}>
                      <FileUp className="h-3.5 w-3.5 text-primary" />
                      Import Konteks (.json / .md)
                    </DropdownMenuItem>
                    {activeConversation && (
                      <DropdownMenuItem onClick={() => setContextDialogOpen(true)}>
                        <Cpu className="h-3.5 w-3.5 text-primary" />
                        Context Window Manager
                      </DropdownMenuItem>
                    )}
                    {!isStandalone && (
                      <DropdownMenuItem onClick={() => void handleInstallAction()}>
                        <MonitorDown className="h-3.5 w-3.5 text-primary" />
                        Install Adam Studio App
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleCycleSkin}>
                      <Palette className="h-3.5 w-3.5" />
                      Skin: {settings.skin}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setCommandOpen(true)}>
                      <Download className="h-3.5 w-3.5" />
                      Command Palette (Ctrl+K)
                    </DropdownMenuItem>
                    {activeConversation && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleExportConversation('md')}>
                          <FileText className="h-3.5 w-3.5" />
                          Export Markdown (.md)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportConversation('json')}>
                          <FileJson className="h-3.5 w-3.5" />
                          Export JSON (.json)
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSettingsDialogOpen(true)}>
                      <Settings className="h-3.5 w-3.5" />
                      Settings & API Key Pool
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              <StudioScroll
                ref={chatScrollRef}
                onViewportReady={setScrollViewport}
                onScroll={handleViewportScroll}
                className="h-full w-full"
                autoHide="scroll"
              >
                {!activeConversation || messageList.length === 0 ? (
                  <div className="relative mx-auto flex min-h-[calc(100dvh-13rem)] w-full max-w-3xl flex-col items-center justify-center px-4 py-8 text-center">
                    <div className="pointer-events-none absolute inset-0 -z-10 bg-dot-matrix opacity-35 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
                    <div className="pointer-events-none absolute top-10 -z-10 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />

                    <motion.div
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.24 }}
                      className="mb-4"
                    >
                      <BrandLogo size="lg" className="shadow-xl" />
                    </motion.div>

                    <div className="mb-2 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border bg-card/90 px-3.5 py-1 text-xs text-muted-foreground shadow-sm">
                      <Cpu className="h-3.5 w-3.5 text-primary" />
                      <span className="font-mono font-semibold text-foreground">
                        {currentModelId}
                      </span>
                      {activeKeyPoolCount > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-400">
                            {activeKeyPoolCount} API Key{activeKeyPoolCount > 1 ? 's Pool' : ''}
                          </span>
                        </>
                      )}
                      {isStandalone && (
                        <>
                          <span>•</span>
                          <span className="text-primary">App Mode</span>
                        </>
                      )}
                    </div>

                    <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
                      Adam Studio Workspace
                    </h1>
                    <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
                      Platform AI dengan Live Thinking, Auto-Rotate Key Pool, Visual Inspector,
                      Per-File Token Counter, & Impor Konteks AI Studio.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setGithubDialogOpen(true)}
                        className="h-8 gap-1.5 rounded-full text-xs shadow-sm"
                      >
                        <FolderGit2 className="h-3.5 w-3.5" />
                        Hubungkan Repo GitHub
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setImportDialogOpen(true)}
                        className="h-8 gap-1.5 rounded-full border-primary/35 bg-primary/5 text-xs text-primary hover:bg-primary/10"
                      >
                        <FileUp className="h-3.5 w-3.5" />
                        Lanjutkan Chat dari Google AI Studio (.json / .md)
                      </Button>
                    </div>

                    {activeKeyPoolCount === 0 && !settings.demoMode && (
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
                        <span>API Key belum aktif.</span>
                        <button
                          type="button"
                          onClick={() => setSettingsDialogOpen(true)}
                          className="font-semibold underline underline-offset-4 hover:text-amber-300"
                        >
                          Isi API Key Pool atau aktifkan Demo SSE
                        </button>
                      </div>
                    )}

                    {/* Welcome Tabs dengan fix kontras isolate + z-0/z-10 */}
                    <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-1 rounded-full border bg-card/80 p-1">
                      {WELCOME_TABS.map((tab) => {
                        const active = welcomeTab === tab;
                        return (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setWelcomeTab(tab)}
                            className={cn(
                              'relative isolate rounded-full px-3 py-1 text-xs font-semibold transition-colors sm:px-3.5',
                              active
                                ? 'text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            {active && (
                              <motion.span
                                layoutId="welcome-tab-pill"
                                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                className="absolute inset-0 z-0 rounded-full bg-primary shadow-sm"
                              />
                            )}
                            <span className="relative z-10">{tab}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-5 grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2">
                      {filteredStarterCards.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.title}
                            type="button"
                            onClick={() => handleSend(item.prompt, [])}
                            className="group rounded-2xl border bg-card/80 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-lg"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
                                  <Icon className="h-3.5 w-3.5" />
                                </div>
                                <span>{item.title}</span>
                              </div>
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {item.category}
                              </Badge>
                            </div>
                            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                              {item.subtitle}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto w-full min-w-0 max-w-3xl px-3 pt-5 sm:px-5 sm:pt-6">
                    {activeConversation.githubProject && (
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/[0.06] px-3.5 py-2.5 text-xs">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate font-semibold text-foreground">
                            {activeConversation.githubProject.owner}/{activeConversation.githubProject.repo}
                          </span>
                          <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                            <GitBranch className="h-2.5 w-2.5" />
                            {activeConversation.githubProject.branch}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {activeConversation.githubProject.pinnedFiles.length} file tersemat •{' '}
                            {activeConversation.githubProject.agenticToolsEnabled ? 'Agentic MCP ON' : 'Manual'}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setGithubDialogOpen(true)}
                            className="h-6 rounded-lg px-2 text-[11px]"
                          >
                            Kelola File
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={handleDetachGitHubProject}
                            className="h-6 w-6 rounded-lg text-muted-foreground hover:text-destructive"
                            title="Putuskan repo dari sesi ini"
                          >
                            <Unlink className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {(activeConversation.importedSource || isContextOverFreeTier) && (
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3.5 py-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-2">
                          <FileUp className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span>
                            {activeConversation.importedSource
                              ? `Sesi lanjutan dari ${activeConversation.importedSource}`
                              : 'Sesi berkapasitas besar'}
                            {activeConversation.compactedContext && (
                              <span className="ml-2 text-emerald-400">
                                • Dioptimalkan ({(contextTokenEstimate / 1000).toFixed(1)}k API tok)
                              </span>
                            )}
                          </span>
                        </span>
                        {isContextOverFreeTier && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setContextDialogOpen(true)}
                            className="h-6 rounded-lg border-amber-500/40 bg-amber-500/15 px-2 text-[11px] text-amber-300 hover:bg-amber-500/25"
                          >
                            Kompres &lt;250k Free Tier
                          </Button>
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                      }}
                    >
                      {virtualizer.getVirtualItems().map((virtualItem) => {
                        const msg = messageList[virtualItem.index];
                        if (!msg) return null;

                        return (
                          <div
                            key={virtualItem.key}
                            data-index={virtualItem.index}
                            ref={virtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualItem.start}px)`,
                            }}
                            className={settings.density === 'compact' ? 'pb-4' : 'pb-6'}
                          >
                            <StreamingChatMessage
                        convId={activeConversation.id}
                        livePlan={
                          msg.id === lastAssistantId && isStreamingActive
                            ? activeConversation.workspace?.plan || null
                            : null
                        }
                        workspaceFileCount={
                          Object.keys(activeConversation.workspace?.files || {}).length
                        }
                        onOpenWorkspace={() => {
                          setActiveArtifact(null);
                          setWorkspaceOpen(true);
                        }}
                              message={msg}
                              compact={settings.density === 'compact'}
                              thinkingEnabled={thinkingEnabled}
                              isLastAssistant={msg.id === lastAssistantId}
                              isStreamingGlobal={isStreamingActive}
                              onContinue={handleContinueLatest}
                          onRegenerate={handleRegenerateLatest}
                              onRetryWithModel={handleRetryWithModel}
                              onEditUserMessage={handleEditUserMessage}
                              onForkFromMessage={handleForkFromMessage}
                              onToggleStar={handleToggleMessageStar}
                              onOpenArtifact={setActiveArtifact}
                              onPreviewImage={setLightboxUrl}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </StudioScroll>

              <StreamAutoScroller viewport={scrollViewport} autoScrollRef={autoScrollEnabledRef} />
              {showScrollBottom && <ScrollBottomPill onScrollBottom={handleJumpBottom} />}
            </div>

            <ChatComposer
            builderMode={activeConversation ? activeConversation.builderMode || 'chat' : draftBuilderMode}
            onToggleBuilderMode={(nextMode) => {
              if (!activeConversation) {
                setDraftBuilderMode(nextMode);
              } else {
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === activeConversation.id
                      ? { ...c, builderMode: nextMode, updatedAt: Date.now() }
                      : c
                  )
                );
              }
              toast.success(
                nextMode === 'emergent'
                  ? 'Emergent Autonomous Builder AKTIF (Plan → Build → Verify)'
                  : 'Kembali ke Chat Mode'
              );
            }}
            workspaceFileCount={
              Object.keys(activeConversation?.workspace?.files || {}).length
            }
            onOpenWorkspace={() => {
              setActiveArtifact(null);
              setWorkspaceOpen(true);
            }}
              model={currentModelId}
              isStreaming={isStreamingActive}
              settings={settings}
              hasApiKeyConfigured={activeKeyPoolCount > 0}
              externalDraft={externalDraft}
              visualTarget={visualTarget}
              onClearVisualTarget={handleClearVisualTarget}
              onClearExternalDraft={handleClearExternalDraft}
              onUpdateSettings={setSettings}
              onSend={handleSend}
              onStop={handleStopStream}
              onPreviewImage={setLightboxUrl}
            />
          </div>

          <AnimatePresence>
            {workspaceOpen && activeConversation && (
        <WorkspacePanel
          workspace={activeConversation.workspace || createEmptyWorkspace()}
          daytonaApiKey={settings.daytonaApiKey}
          daytonaApiUrl={settings.daytonaApiUrl}
          onUpdateSandbox={(info) =>
            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== activeConversation.id) return c;
                const baseWs = c.workspace || createEmptyWorkspace();
                return {
                  ...c,
                  workspace: {
                    ...baseWs,
                    daytonaSandboxId: info.sandboxId ?? baseWs.daytonaSandboxId,
                    daytonaPreviewUrl:
                      info.previewUrl !== undefined ? info.previewUrl : baseWs.daytonaPreviewUrl,
                    daytonaPreviewToken:
                      info.previewToken !== undefined
                        ? info.previewToken
                        : baseWs.daytonaPreviewToken,
                  },
                };
              })
            )
          }
          onChangeActiveFile={(filePath) =>
            setConversations((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id && c.workspace
                  ? { ...c, workspace: { ...c.workspace, activePath: filePath } }
                  : c
              )
            )
          }
          onEditFile={(filePath, content) =>
            setConversations((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id
                  ? {
                      ...c,
                      workspace: upsertWorkspaceFile(c.workspace, filePath, content),
                      updatedAt: Date.now(),
                    }
                  : c
              )
            )
          }
          onCreateFile={(filePath) =>
            setConversations((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id
                  ? {
                      ...c,
                      workspace: upsertWorkspaceFile(c.workspace, filePath, ''),
                      updatedAt: Date.now(),
                    }
                  : c
              )
            )
          }
          onDeleteFile={(filePath) =>
            setConversations((prev) =>
              prev.map((c) =>
                c.id === activeConversation.id
                  ? {
                      ...c,
                      workspace: removeWorkspaceFile(c.workspace, filePath),
                      updatedAt: Date.now(),
                    }
                  : c
              )
            )
          }
          onAutoFixError={(errorMsg) => {
            const forceEmergentFix = activeConversation.builderMode !== 'emergent';
            if (forceEmergentFix) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === activeConversation.id
                    ? { ...c, builderMode: 'emergent', updatedAt: Date.now() }
                    : c
                )
              );
            }
            handleSend(
              `Live Preview / Terminal mengalami error berikut. Periksa file workspace terkait, perbaiki bug atau package.json-nya, jalankan workspace_verify_project, dan bila Daytona aktif nyalakan ulang via sandbox_start_preview:\n\n\`\`\`\n${errorMsg}\n\`\`\``,
              []
            );
          }}
          onClose={() => setWorkspaceOpen(false)}
        />
      )}
      {activeArtifact && !workspaceOpen && (
              <>
                {!artifactFullscreen && (
                  <div
                    onPointerDown={startResizingPane}
                    className="hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l bg-border/40 transition-colors hover:bg-primary/60 lg:flex"
                    title="Tarik untuk mengubah lebar Canvas"
                  />
                )}
                <motion.aside
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.14 }}
                  className={cn(
                    'fixed inset-0 z-40 border-l lg:static',
                    artifactFullscreen ? 'lg:flex-1' : 'lg:shrink-0'
                  )}
                >
                  <div
                    style={
                      {
                        '--artifact-w': `${artifactWidthPct}vw`,
                      } as CSSProperties
                    }
                    className={cn(
                      'h-full w-full',
                      !artifactFullscreen &&
                        'lg:w-[var(--artifact-w)] lg:min-w-[360px] lg:max-w-[68vw]'
                    )}
                  >
                    <ArtifactPanel
                      artifact={activeArtifact}
                      allArtifacts={conversationArtifacts}
                      isResizing={isResizingPane}
                      isFullscreen={artifactFullscreen}
                      onToggleFullscreen={handleToggleArtifactFs}
                      onSelectArtifact={setActiveArtifact}
                      onInsertToChat={handleInsertToChat}
                      onFixErrorWithAi={handleFixErrorWithAi}
                      onSelectVisualTarget={handleSelectVisualTarget}
                      onClose={handleCloseArtifact}
                    />
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          <ModelSelectorDialog
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
            selectedModel={currentModelId}
            onSelectModel={handleSelectModel}
          />

          <SettingsDialog
        activeModel={currentModelId}
            open={settingsDialogOpen}
            onOpenChange={setSettingsDialogOpen}
            settings={settings}
            serverHealth={serverHealth}
            onSave={setSettings}
            onConversationsRestored={(restored) => {
              setConversations(restored);
              if (restored.length > 0) setActiveId(restored[0].id);
            }}
          />

          <ImportChatDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            hasActiveSession={Boolean(activeConversation && activeConversation.messages.length > 0)}
            activeSessionTitle={activeConversation?.title}
            defaultModel={currentModelId}
            onConfirmImport={handleConfirmImport}
          />

          <GitHubConnectorDialog
            open={githubDialogOpen}
            onOpenChange={setGithubDialogOpen}
            githubToken={settings.githubToken}
            onUpdateGithubToken={handleUpdateGithubToken}
            currentProject={activeConversation?.githubProject}
            onAttachProject={handleAttachGitHubProject}
            onDetachProject={handleDetachGitHubProject}
          />

          <ContextManagerDialog
            open={contextDialogOpen}
            onOpenChange={setContextDialogOpen}
            conversation={activeConversation}
            apiKey={settings.apiKey}
            hasApiKey={activeKeyPoolCount > 0}
            onApplyCompaction={handleApplyCompaction}
          />

          <CommandPalette
            open={commandOpen}
            onOpenChange={setCommandOpen}
            conversations={conversations}
            activeSkin={settings.skin}
            onNewChat={handleNewChat}
            onImportChat={() => setImportDialogOpen(true)}
            onSelectConversation={(id) => {
              if (isStreamingActive) handleStopStream();
              setActiveId(id);
              setActiveArtifact(null);
              setArtifactFullscreen(false);
            }}
            onOpenModelSelector={() => setModelDialogOpen(true)}
            onOpenSettings={() => setSettingsDialogOpen(true)}
            onOpenBookmarks={() => setBookmarksOpen(true)}
            onToggleZenMode={() => setZenMode((z) => !z)}
            onCycleSkin={handleCycleSkin}
            onExportMarkdown={() => handleExportConversation('md')}
            onInsertTemplate={(tpl) => setExternalDraft(tpl)}
            showInstallOption={!isStandalone}
            onInstallApp={() => void handleInstallAction()}
          />

          <BookmarksDialog
            open={bookmarksOpen}
            onOpenChange={setBookmarksOpen}
            conversations={conversations}
            onJumpToConversation={(convId) => {
              if (isStreamingActive) handleStopStream();
              setActiveId(convId);
            }}
            onToggleStar={handleToggleStar}
          />

          <InstallAppDialog
            open={installDialogOpen}
            onOpenChange={setInstallDialogOpen}
            isIos={isIos}
            canNativeInstall={canNativeInstall}
            onNativeInstall={() => {
              void handleInstallAction().then(() => setInstallDialogOpen(false));
            }}
          />

          <Dialog open={Boolean(lightboxUrl)} onOpenChange={() => setLightboxUrl(null)}>
            <DialogContent className="max-w-4xl border-0 bg-transparent p-2 shadow-none">
              <DialogHeader className="sr-only">
                <DialogTitle>Image Preview</DialogTitle>
              </DialogHeader>
              {lightboxUrl && (
                <img
                  src={lightboxUrl}
                  alt="Attachment Preview"
                  className="max-h-[85dvh] w-full rounded-2xl object-contain shadow-2xl"
                />
              )}
            </DialogContent>
          </Dialog>
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
}
