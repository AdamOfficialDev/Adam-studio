import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  WifiOff,
  Workflow,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
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
import { BookmarksDialog } from '@/components/BookmarksDialog';
import { ChatComposer } from '@/components/ChatComposer';
import { ChatMessage } from '@/components/ChatMessage';
import { CommandPalette } from '@/components/CommandPalette';
import { ModelSelectorDialog } from '@/components/ModelSelectorDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Sidebar } from '@/components/Sidebar';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { extractArtifactsFromMarkdown } from '@/lib/artifacts';
import { DEFAULT_MODEL_ID, getModelInfo } from '@/lib/models';
import { streamChatCompletion } from '@/lib/sse';
import { loadConversations, loadSettings, saveConversations, saveSettings } from '@/lib/storage';
import { cn, estimateTokens, generateId } from '@/lib/utils';
import type {
  AppSettings,
  ArtifactItem,
  Attachment,
  ChatMessage as ChatMessageType,
  Conversation,
  ServerHealth,
  ThemeSkin,
  TokenUsage,
} from '@/types/chat';

type WelcomeTab = 'All' | 'Coding' | 'UI/Design' | 'Agentic';

interface ActiveStreamState {
  convId: string;
  msgId: string;
  content: string;
  thought: string;
  statusText?: string;
  tps: number;
  thinkingDurationMs?: number;
  usage?: TokenUsage;
}

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
    subtitle: 'HTML + CSS + JS lengkap yang langsung live di Artifact Canvas',
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

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'new') return null;
    const existing = loadConversations();
    return existing[0]?.id ?? null;
  });
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
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [activeArtifact, setActiveArtifact] = useState<ArtifactItem | null>(null);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [artifactWidthPct, setArtifactWidthPct] = useState(46);
  const [isResizingPane, setIsResizingPane] = useState(false);

  const [welcomeTab, setWelcomeTab] = useState<WelcomeTab>('All');
  const [externalDraft, setExternalDraft] = useState<string | null>(null);
  const [activeStream, setActiveStream] = useState<ActiveStreamState | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

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
  const activeStreamRef = useRef<ActiveStreamState | null>(null);
  const chatScrollRef = useRef<StudioScrollHandle | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeStreamRef.current = activeStream;
  }, [activeStream]);

  useEffect(() => {
    saveConversations(conversations);
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

  const currentModelId = activeConversation?.model ?? selectedModel;
  const currentModelInfo = getModelInfo(currentModelId);
  const isStreamingActive = activeStream !== null;
  const thinkingEnabled = settings.includeThoughts && settings.thinkingBudget !== 0;

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
    const textSum = activeConversation.messages.reduce(
      (acc, m) => acc + estimateTokens(m.content) + estimateTokens(m.thought || ''),
      0
    );
    return textSum + estimateTokens(settings.systemInstruction);
  }, [activeConversation, settings.systemInstruction]);

  const contextUsagePct = Math.min(
    100,
    Math.max(1, Math.round((contextTokenEstimate / currentModelInfo.contextLimit) * 100))
  );

  const scrollToBottom = useCallback((smooth = false) => {
    const el = chatScrollRef.current?.getViewport();
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  useEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom(false);
    }
  }, [
    activeConversation?.messages.length,
    activeStream?.content,
    activeStream?.thought,
    scrollToBottom,
  ]);

  const handleViewportScroll = useCallback((el: HTMLElement) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 90;
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

    const current = activeStreamRef.current;
    activeStreamRef.current = null;
    setActiveStream(null);

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
                        statusText: undefined,
                        usage: current.usage ?? m.usage,
                        metrics: current.thinkingDurationMs
                          ? { ...m.metrics, thinkingDurationMs: current.thinkingDurationMs }
                          : m.metrics,
                        isStreaming: false,
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
    setArtifactFullscreen(false);
  }, [handleStopStream, isStreamingActive]);

  const handleCycleSkin = useCallback(() => {
    setSettings((prev) => {
      const idx = SKIN_ORDER.indexOf(prev.skin);
      const nextSkin = SKIN_ORDER[(idx + 1) % SKIN_ORDER.length];
      toast.success(`Tema diganti ke ${nextSkin.toUpperCase()}`);
      return { ...prev, skin: nextSkin };
    });
  }, []);

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
      assistantMessageId: string
    ) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      autoScrollEnabledRef.current = true;

      const trimmedHistory =
        settings.maxHistoryMessages > 0 && historyMessages.length > settings.maxHistoryMessages
          ? historyMessages.slice(-settings.maxHistoryMessages)
          : historyMessages;

      const startedAt = performance.now();
      let firstThoughtAt: number | null = null;
      let firstAnswerAt: number | null = null;
      let thinkingDurationMs: number | undefined = undefined;
      let accContent = '';
      let accThought = '';
      let currentStatus: string | undefined = undefined;
      let accUsage: TokenUsage | undefined = undefined;
      let chunkCount = 0;

      const initialStream: ActiveStreamState = {
        convId,
        msgId: assistantMessageId,
        content: '',
        thought: '',
        tps: 0,
      };
      activeStreamRef.current = initialStream;
      setActiveStream(initialStream);

      const commitStreamSnapshot = () => {
        flushTimerRef.current = null;
        if (!activeStreamRef.current) return;
        const elapsed = Math.max(100, performance.now() - (firstAnswerAt ?? startedAt));
        const estTok = Math.max(chunkCount, Math.round(accContent.length / 4));
        const tps = firstAnswerAt ? Number(((estTok / elapsed) * 1000).toFixed(1)) : 0;
        const snapshot: ActiveStreamState = {
          convId,
          msgId: assistantMessageId,
          content: accContent,
          thought: accThought,
          statusText: currentStatus,
          tps,
          thinkingDurationMs,
          usage: accUsage,
        };
        activeStreamRef.current = snapshot;
        setActiveStream(snapshot);
      };

      const scheduleFlush = () => {
        if (flushTimerRef.current !== null) return;
        const cadence = accContent.length > 3000 ? 55 : 24;
        flushTimerRef.current = window.setTimeout(commitStreamSnapshot, cadence);
      };

      try {
        await streamChatCompletion(
          {
            model: modelId,
            messages: trimmedHistory.map((m) => ({
              role: m.role,
              content: m.content,
              attachments: m.attachments,
            })),
            systemInstruction: settings.systemInstruction,
            temperature: settings.temperature,
            maxOutputTokens: settings.maxOutputTokens,
            includeThoughts: settings.includeThoughts,
            thinkingBudget: settings.thinkingBudget,
            autoFallbackOnOverload: settings.autoFallbackOnOverload,
            fallbackModel: settings.fallbackModel,
            demoMode: settings.demoMode,
            apiKey: settings.apiKey,
          },
          {
            signal: controller.signal,
            onStatus: (statusMessage) => {
              currentStatus = statusMessage;
              commitStreamSnapshot();
            },
            onThought: (thoughtChunk) => {
              currentStatus = undefined;
              if (firstThoughtAt === null) firstThoughtAt = performance.now();
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
            onInfo: (infoMsg) => {
              toast.info(infoMsg);
            },
            onDone: ({ model: resolvedModel, isDemo }) => {
              if (flushTimerRef.current !== null) {
                window.clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
              }
              activeStreamRef.current = null;
              setActiveStream(null);

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
                                statusText: undefined,
                                usage: accUsage,
                                isStreaming: false,
                                isDemo,
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
              activeStreamRef.current = null;
              setActiveStream(null);
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
                                statusText: undefined,
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
        activeStreamRef.current = null;
        setActiveStream(null);
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
                          statusText: undefined,
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
          if (activeStreamRef.current?.msgId === assistantMessageId) {
            activeStreamRef.current = null;
            setActiveStream(null);
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

      const userMessage: ChatMessageType = {
        id: generateId(),
        role: 'user',
        content: text,
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
          messages: [userMessage, assistantPlaceholder],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        setConversations((prev) => [newConv, ...prev]);
        setActiveId(newId);
        void runStreamForConversation(newId, currentModelId, [userMessage], assistantMessageId);
      } else {
        const historyForModel = [...activeConversation.messages, userMessage];
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id !== activeConversation.id
              ? conv
              : {
                  ...conv,
                  updatedAt: Date.now(),
                  messages: [...conv.messages, userMessage, assistantPlaceholder],
                }
          )
        );
        void runStreamForConversation(
          activeConversation.id,
          currentModelId,
          historyForModel,
          assistantMessageId
        );
      }
    },
    [activeConversation, currentModelId, isStreamingActive, runStreamForConversation]
  );

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
        assistantMessageId
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
        assistantMessageId
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
      if (activeStreamRef.current?.convId === id) handleStopStream();
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

  const lastAssistantId = useMemo(() => {
    const msgs = activeConversation?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i].id;
    }
    return null;
  }, [activeConversation]);

  const filteredStarterCards = useMemo(() => {
    if (welcomeTab === 'All') return STARTER_CARDS;
    return STARTER_CARDS.filter((c) => c.category === welcomeTab);
  }, [welcomeTab]);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Toaster
          richColors
          position="bottom-right"
          theme={settings.skin === 'paper' ? 'light' : 'dark'}
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
              onSelectConversation={(id) => {
                if (isStreamingActive) handleStopStream();
                setActiveId(id);
                setActiveArtifact(null);
                setArtifactFullscreen(false);
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

                {isStreamingActive && (
                  <Badge variant="outline" className="hidden font-mono text-[10px] sm:inline-flex">
                    {activeStream.statusText
                      ? 'Retrying...'
                      : activeStream.tps > 0
                        ? `${activeStream.tps} tok/s`
                        : 'Thinking...'}
                  </Badge>
                )}
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
                    <div className="hidden items-center gap-2 rounded-full border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground lg:flex">
                      <span className="font-mono">
                        {(contextTokenEstimate / 1000).toFixed(1)}k ctx
                      </span>
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${contextUsagePct}%` }}
                        />
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    Estimasi context (~{contextTokenEstimate.toLocaleString()} /{' '}
                    {currentModelInfo.contextLimit.toLocaleString()} tokens)
                  </TooltipContent>
                </Tooltip>

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
                        {settings.demoMode ? 'Demo SSE' : 'Live SSE'}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {settings.demoMode
                      ? 'Mode simulasi SSE lokal aktif'
                      : 'Streaming SSE ke /api/chat (Auto-Retry 3x)'}
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
                    {!isStandalone && (
                      <>
                        <DropdownMenuItem onClick={() => void handleInstallAction()}>
                          <MonitorDown className="h-3.5 w-3.5 text-primary" />
                          Install Adam Studio App
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
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
                      Settings & API Key
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              <StudioScroll
                ref={chatScrollRef}
                onScroll={handleViewportScroll}
                className="h-full w-full"
                autoHide="scroll"
              >
                {!activeConversation || activeConversation.messages.length === 0 ? (
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
                      <span className="hidden sm:inline">•</span>
                      <span className="hidden sm:inline">
                        ${currentModelInfo.inputPricePerMillion.toFixed(2)} / $
                        {currentModelInfo.outputPricePerMillion.toFixed(2)} per 1M
                      </span>
                      {isStandalone && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-400">App Mode</span>
                        </>
                      )}
                    </div>

                    <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
                      Adam Studio Workspace
                    </h1>
                    <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
                      Platform AI real-time SSE dengan Live Thinking ala Google AI Studio,
                      Auto-Retry 503/429, Pro Code Blocks, dan Artifact IDE Canvas.
                    </p>

                    {!settings.apiKey &&
                      !serverHealth?.hasServerApiKey &&
                      !settings.demoMode && (
                        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
                          <span>API Key belum aktif.</span>
                          <button
                            type="button"
                            onClick={() => setSettingsDialogOpen(true)}
                            className="font-semibold underline underline-offset-4 hover:text-amber-300"
                          >
                            Isi API Key atau aktifkan Demo SSE Showcase
                          </button>
                        </div>
                      )}

                    <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-1 rounded-full border bg-card/80 p-1">
                      {WELCOME_TABS.map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setWelcomeTab(tab)}
                          className={cn(
                            'relative rounded-full px-3 py-1 text-xs font-medium transition-colors sm:px-3.5',
                            welcomeTab === tab
                              ? 'text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {welcomeTab === tab && (
                            <motion.span
                              layoutId="welcome-tab-pill"
                              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                              className="absolute inset-0 -z-10 rounded-full bg-primary shadow-sm"
                            />
                          )}
                          {tab}
                        </button>
                      ))}
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
                  <div
                    className={cn(
                      'mx-auto w-full min-w-0 max-w-3xl px-3 py-5 sm:px-5 sm:py-6',
                      settings.density === 'compact' ? 'space-y-4' : 'space-y-6'
                    )}
                  >
                    {activeConversation.messages.map((msg) => {
                      const effectiveMsg =
                        activeStream &&
                        activeStream.convId === activeConversation.id &&
                        activeStream.msgId === msg.id
                          ? {
                              ...msg,
                              content: activeStream.content,
                              thought: activeStream.thought || msg.thought,
                              statusText: activeStream.statusText,
                              metrics: activeStream.thinkingDurationMs
                                ? {
                                    ...msg.metrics,
                                    thinkingDurationMs: activeStream.thinkingDurationMs,
                                  }
                                : msg.metrics,
                              isStreaming: true,
                            }
                          : msg;

                      return (
                        <ChatMessage
                          key={msg.id}
                          message={effectiveMsg}
                          compact={settings.density === 'compact'}
                          thinkingEnabled={thinkingEnabled}
                          isLastAssistant={msg.id === lastAssistantId}
                          onRegenerate={
                            msg.id === lastAssistantId ? () => handleRegenerate() : undefined
                          }
                          onRetryWithModel={
                            msg.id === lastAssistantId
                              ? (mId) => handleRegenerate(mId)
                              : undefined
                          }
                          onEditUserMessage={
                            msg.role === 'user' && !isStreamingActive
                              ? handleEditUserMessage
                              : undefined
                          }
                          onForkFromMessage={
                            msg.role === 'assistant' && !isStreamingActive
                              ? handleForkFromMessage
                              : undefined
                          }
                          onToggleStar={(msgId) =>
                            handleToggleStar(activeConversation.id, msgId)
                          }
                          onOpenArtifact={setActiveArtifact}
                          onPreviewImage={setLightboxUrl}
                        />
                      );
                    })}
                  </div>
                )}
              </StudioScroll>

              {showScrollBottom && (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={() => {
                    autoScrollEnabledRef.current = true;
                    scrollToBottom(true);
                  }}
                  className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border shadow-xl"
                  aria-label="Scroll ke bawah"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              )}
            </div>

            <ChatComposer
              model={currentModelId}
              isStreaming={isStreamingActive}
              settings={settings}
              externalDraft={externalDraft}
              onClearExternalDraft={() => setExternalDraft(null)}
              onUpdateSettings={setSettings}
              onSend={handleSend}
              onStop={handleStopStream}
              onPreviewImage={setLightboxUrl}
            />
          </div>

          <AnimatePresence>
            {activeArtifact && (
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
                  transition={{ duration: 0.16 }}
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
                      onToggleFullscreen={() => setArtifactFullscreen((f) => !f)}
                      onSelectArtifact={setActiveArtifact}
                      onClose={() => {
                        setActiveArtifact(null);
                        setArtifactFullscreen(false);
                      }}
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
            open={settingsDialogOpen}
            onOpenChange={setSettingsDialogOpen}
            settings={settings}
            serverHealth={serverHealth}
            onSave={setSettings}
          />

          <CommandPalette
            open={commandOpen}
            onOpenChange={setCommandOpen}
            conversations={conversations}
            activeSkin={settings.skin}
            onNewChat={handleNewChat}
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
