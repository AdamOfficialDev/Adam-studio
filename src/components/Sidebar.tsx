import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Command,
  Cpu,
  Database,
  FileCode2,
  FileUp,
  FolderGit2,
  KeyRound,
  Layers,
  MessageSquare,
  MonitorDown,
  MonitorSmartphone,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { estimateCostNumber } from '@/lib/models';
import {
  SIDEBAR_DATE_BUCKETS,
  convHasCanvas,
  convHasGitHub,
  convIsDevice,
  convIsEmergent,
  extractSearchSnippet,
  formatCompactTokens,
  formatRelativeShort,
  getDateBucket,
  shortModelTag,
  splitHighlightText,
  type SidebarDateBucket,
  type SidebarFilter,
} from '@/lib/sidebarUtils';
import { useStreamingConvId } from '@/lib/streamStore';
import { cn } from '@/lib/utils';
import type { Conversation, KeyPoolSummary, ThemeSkin } from '@/types/chat';

const SIDEBAR_WIDTH_KEY = 'adam-studio-sidebar-width';
const SIDEBAR_FOOTER_KEY = 'adam-studio-sidebar-footer-expanded';
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 420;

interface SidebarProps {
  open: boolean;
  mobileOpen: boolean;
  onToggleDesktop: () => void;
  onCloseMobile: () => void;
  conversations: Conversation[];
  activeId: string | null;
  onNewChat: () => void;
  onImportChat: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onTogglePinConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  onOpenBookmarks: () => void;
  onOpenDeviceControl?: () => void;
  onCycleSkin: () => void;
  showInstallButton?: boolean;
  onInstallApp?: () => void;
  keyPoolSummary?: KeyPoolSummary | null;
  activeKeyPoolCount?: number;
  skin?: ThemeSkin;
  demoMode?: boolean;
}

function loadSavedWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
    }
  } catch {
    // Abaikan error storage
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

function loadFooterExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_FOOTER_KEY) === 'true';
  } catch {
    return false;
  }
}

export const Sidebar = memo(function Sidebar({
  open,
  mobileOpen,
  onToggleDesktop,
  onCloseMobile,
  conversations,
  activeId,
  onNewChat,
  onImportChat,
  onSelectConversation,
  onRenameConversation,
  onTogglePinConversation,
  onDeleteConversation,
  onOpenSettings,
  onOpenCommandPalette,
  onOpenBookmarks,
  onOpenDeviceControl,
  onCycleSkin,
  showInstallButton = false,
  onInstallApp,
  keyPoolSummary = null,
  activeKeyPoolCount = 0,
  skin = 'obsidian',
  demoMode = false,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<SidebarFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [collapsedBuckets, setCollapsedBuckets] = useState<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSavedWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [footerExpanded, setFooterExpanded] = useState<boolean>(loadFooterExpanded);

  const streamingConvId = useStreamingConvId();
  const touchStartXRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Abaikan error storage
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_FOOTER_KEY, String(footerExpanded));
    } catch {
      // Abaikan error storage
    }
  }, [footerExpanded]);

  const startResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = sidebarWidth;
      setIsResizing(true);

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (moveEvt: PointerEvent) => {
        const delta = moveEvt.clientX - startX;
        const nextW = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, Math.round(startW + delta))
        );
        setSidebarWidth(nextW);
      };

      const onUp = () => {
        setIsResizing(false);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [sidebarWidth]
  );

  const resetWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);

  const toggleBucket = useCallback((bucket: string) => {
    setCollapsedBuckets((prev) => ({ ...prev, [bucket]: !prev[bucket] }));
  }, []);

  const {
    totalTokens,
    totalCost,
    totalMessages,
    canvasIds,
    emergentIds,
    githubIds,
    deviceIds,
    pinnedCount,
  } = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    let msgs = 0;
    let pinCount = 0;
    const withCanvas = new Set<string>();
    const withEmergent = new Set<string>();
    const withGithub = new Set<string>();
    const withDevice = new Set<string>();

    for (const c of conversations) {
      msgs += c.messages.length;
      if (c.pinned) pinCount += 1;
      if (convHasCanvas(c)) withCanvas.add(c.id);
      if (convIsEmergent(c)) withEmergent.add(c.id);
      if (convHasGitHub(c)) withGithub.add(c.id);
      if (convIsDevice(c)) withDevice.add(c.id);

      for (const m of c.messages) {
        if (m.usage?.totalTokenCount) tokens += m.usage.totalTokenCount;
        cost += estimateCostNumber(m.model || c.model, m.usage);
      }
    }

    return {
      totalTokens: tokens,
      totalCost: cost,
      totalMessages: msgs,
      canvasIds: withCanvas,
      emergentIds: withEmergent,
      githubIds: withGithub,
      deviceIds: withDevice,
      pinnedCount: pinCount,
    };
  }, [conversations]);

  const pinnedAll = useMemo(
    () =>
      conversations
        .filter((c) => c.pinned)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5),
    [conversations]
  );

  const { pinned, grouped, filteredTotal } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = conversations
      .filter((c) => {
        const matchesTitle = c.title.toLowerCase().includes(q);
        const matchesRepo =
          Boolean(q) &&
          Boolean(c.githubProject) &&
          `${c.githubProject?.owner}/${c.githubProject?.repo}`.toLowerCase().includes(q);
        const matchesContent =
          !matchesTitle &&
          !matchesRepo &&
          Boolean(q) &&
          c.messages.some((m) => m.content && m.content.toLowerCase().includes(q));
        const matchesQuery = !q || matchesTitle || matchesRepo || matchesContent;

        const matchesTab =
          filterTab === 'all' ||
          (filterTab === 'pinned' && Boolean(c.pinned)) ||
          (filterTab === 'emergent' && emergentIds.has(c.id)) ||
          (filterTab === 'github' && githubIds.has(c.id)) ||
          (filterTab === 'device' && deviceIds.has(c.id)) ||
          (filterTab === 'canvas' && canvasIds.has(c.id));

        return matchesQuery && matchesTab;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const pinnedList = filtered.filter((c) => c.pinned);
    const regularList = filtered.filter((c) => !c.pinned);

    const groups: Record<SidebarDateBucket, Conversation[]> = {
      'Hari Ini': [],
      Kemarin: [],
      '7 Hari Terakhir': [],
      'Bulan Ini': [],
      'Lebih Lama': [],
    };

    for (const conv of regularList) {
      groups[getDateBucket(conv.updatedAt)].push(conv);
    }

    return {
      pinned: pinnedList,
      grouped: groups,
      filteredTotal: filtered.length,
    };
  }, [conversations, filterTab, search, canvasIds, emergentIds, githubIds, deviceIds]);

  const filterTabs = useMemo(
    () =>
      [
        { id: 'all', label: 'Semua', count: conversations.length },
        { id: 'pinned', label: 'Pin', count: pinnedCount },
        { id: 'emergent', label: 'Emergent', count: emergentIds.size },
        { id: 'github', label: 'GitHub', count: githubIds.size },
        { id: 'device', label: 'Device', count: deviceIds.size },
        { id: 'canvas', label: 'Canvas', count: canvasIds.size },
      ] as const,
    [
      conversations.length,
      pinnedCount,
      emergentIds.size,
      githubIds.size,
      deviceIds.size,
      canvasIds.size,
    ]
  );

  const commitRename = (id: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      onRenameConversation(id, trimmed);
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const handleTouchStart = (e: TouchEvent<HTMLElement>) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: TouchEvent<HTMLElement>) => {
    if (touchStartXRef.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    if (touchStartXRef.current - endX > 65) {
      onCloseMobile();
    }
    touchStartXRef.current = null;
  };

  const renderSessionIcon = (conv: Conversation, isStreaming: boolean) => {
    if (isStreaming) {
      return (
        <span className="relative flex h-3.5 w-3.5 items-center justify-center">
          <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      );
    }
    if (conv.pinned) return <Pin className="h-3.5 w-3.5 text-primary" />;
    if (emergentIds.has(conv.id)) return <FileCode2 className="h-3.5 w-3.5 text-emerald-400" />;
    if (deviceIds.has(conv.id)) return <MonitorSmartphone className="h-3.5 w-3.5 text-sky-400" />;
    if (githubIds.has(conv.id)) return <FolderGit2 className="h-3.5 w-3.5 text-violet-400" />;
    return <MessageSquare className="h-3.5 w-3.5 opacity-60" />;
  };

  const renderConversationRow = (conv: Conversation) => {
    const isActive = conv.id === activeId;
    const isEditing = editingId === conv.id;
    const isStreaming = streamingConvId === conv.id;
    const hasCanvas = canvasIds.has(conv.id);
    const wsFilesCount = Object.keys(conv.workspace?.files || {}).length;
    const isEmergent = emergentIds.has(conv.id);
    const isDevice = deviceIds.has(conv.id);
    const trimmedQuery = search.trim();
    const titleHighlight = trimmedQuery ? splitHighlightText(conv.title, trimmedQuery) : null;
    const searchSnippet =
      trimmedQuery && !titleHighlight ? extractSearchSnippet(conv, trimmedQuery) : null;

    if (isEditing) {
      return (
        <div
          key={conv.id}
          className="flex items-center gap-1 rounded-lg border border-primary/50 bg-background/95 p-1 shadow-sm"
        >
          <Input
            autoFocus
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(conv.id);
              if (e.key === 'Escape') cancelRename();
            }}
            placeholder="Judul sesi..."
            className="h-6 flex-1 rounded-md border-0 bg-muted/50 px-2 text-xs shadow-none focus-visible:ring-1"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commitRename(conv.id)}
            className="h-6 w-6 shrink-0 rounded-md text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300"
            title="Simpan"
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancelRename}
            className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            title="Batal"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div
        key={conv.id}
        className={cn(
          'group relative flex items-start gap-2 rounded-lg border px-2 py-1.5 transition-colors',
          isActive
            ? 'border-primary/35 bg-accent/85 text-foreground shadow-sm'
            : 'border-transparent text-muted-foreground hover:border-border/50 hover:bg-accent/40 hover:text-foreground'
        )}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute bottom-1.5 left-0.5 top-1.5 w-[2.5px] rounded-full bg-primary"
          />
        )}

        <div className={cn('mt-0.5 shrink-0', isActive && 'pl-1')}>
          {renderSessionIcon(conv, isStreaming)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => {
                onSelectConversation(conv.id);
                onCloseMobile();
              }}
              className="min-w-0 flex-1 text-left"
            >
              <div
                className={cn(
                  'truncate text-[12px] leading-tight tracking-[-0.01em]',
                  isActive ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'
                )}
              >
                {titleHighlight ? (
                  <>
                    {titleHighlight.before}
                    <mark className="rounded bg-primary/25 px-0.5 text-foreground">
                      {titleHighlight.match}
                    </mark>
                    {titleHighlight.after}
                  </>
                ) : (
                  conv.title
                )}
              </div>
            </button>

            {/* Timestamp (hides on desktop hover to reveal quick-action dock) */}
            <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/70 md:group-hover:hidden">
              {formatRelativeShort(conv.updatedAt)}
            </span>

            {/* Desktop hover quick actions + Mobile menu trigger */}
            <div className="flex shrink-0 items-center gap-0.5 md:hidden md:group-hover:flex md:group-focus-within:flex">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePinConversation(conv.id);
                }}
                className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/80 hover:text-primary md:inline-flex"
                title={conv.pinned ? 'Lepas Sematan' : 'Sematkan'}
                aria-label={conv.pinned ? 'Lepas Sematan' : 'Sematkan'}
              >
                {conv.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(conv.id);
                  setEditingTitle(conv.title);
                }}
                className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/80 hover:text-foreground md:inline-flex"
                title="Ubah Judul"
                aria-label="Ubah Judul"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/80 hover:text-foreground"
                    aria-label="Opsi percakapan"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => onTogglePinConversation(conv.id)}>
                    {conv.pinned ? (
                      <>
                        <PinOff className="h-3.5 w-3.5" />
                        Lepas Sematan
                      </>
                    ) : (
                      <>
                        <Pin className="h-3.5 w-3.5" />
                        Sematkan Chat
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setEditingId(conv.id);
                      setEditingTitle(conv.title);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Ubah Judul
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDeleteConversation(conv.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus Chat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Rich Metadata Micro-Badges */}
          <button
            type="button"
            onClick={() => {
              onSelectConversation(conv.id);
              onCloseMobile();
            }}
            className="mt-1 flex w-full flex-wrap items-center gap-1 text-left text-[10px] text-muted-foreground"
          >
            <span className="rounded border border-border/50 bg-background/80 px-1 py-0 font-mono text-[9px] leading-[15px] text-muted-foreground">
              {shortModelTag(conv.model)}
            </span>
            <span className="font-mono text-[9.5px] opacity-75">{conv.messages.length}m</span>

            {isStreaming && (
              <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1 py-0 text-[9px] font-semibold leading-[15px] text-primary">
                Live
              </span>
            )}

            {isEmergent && (
              <span className="rounded bg-emerald-500/15 px-1 py-0 font-mono text-[9px] leading-[15px] text-emerald-400">
                {wsFilesCount > 0 ? `E1·${wsFilesCount}f` : 'E1'}
              </span>
            )}

            {isDevice && (
              <span className="rounded bg-sky-500/15 px-1 py-0 text-[9px] leading-[15px] text-sky-400">
                Device
              </span>
            )}

            {conv.githubProject && (
              <span className="max-w-[84px] truncate rounded bg-violet-500/15 px-1 py-0 font-mono text-[9px] leading-[15px] text-violet-400">
                {conv.githubProject.repo}
              </span>
            )}

            {hasCanvas && wsFilesCount === 0 && (
              <span
                className="inline-flex items-center rounded bg-primary/10 px-1 py-0 text-[9px] leading-[15px] text-primary"
                title="Memiliki Artifact Canvas"
              >
                <Layers className="h-2.5 w-2.5" />
              </span>
            )}

            {conv.compactedContext && (
              <span
                className="rounded bg-amber-500/10 px-1 py-0 text-[9px] leading-[15px] text-amber-400/90"
                title="Rolling Memory Aktif"
              >
                Mem
              </span>
            )}
          </button>

          {/* Search Content Snippet Match */}
          {searchSnippet && (
            <button
              type="button"
              onClick={() => {
                onSelectConversation(conv.id);
                onCloseMobile();
              }}
              className="mt-1.5 block w-full rounded-md border border-border/45 bg-background/65 px-1.5 py-1 text-left text-[10px] leading-snug text-muted-foreground transition-colors hover:border-primary/35"
            >
              <span className="line-clamp-2">
                <span className="mr-1 font-mono text-[9px] font-semibold uppercase text-foreground/75">
                  {searchSnippet.role === 'user'
                    ? 'You:'
                    : searchSnippet.role === 'repo'
                      ? 'Repo:'
                      : 'AI:'}
                </span>
                {searchSnippet.before}
                <mark className="rounded bg-primary/25 px-0.5 text-foreground">
                  {searchSnippet.match}
                </mark>
                {searchSnippet.after}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSectionGroup = (
    label: string,
    items: Conversation[],
    accentPrimary = false
  ) => {
    if (items.length === 0) return null;
    const isSearching = search.trim().length > 0;
    const isCollapsed = !isSearching && Boolean(collapsedBuckets[label]);

    return (
      <div key={label} className="space-y-0.5">
        <button
          type="button"
          onClick={() => toggleBucket(label)}
          className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors hover:bg-accent/40"
        >
          <span
            className={cn(
              'flex items-center gap-1',
              accentPrimary ? 'text-primary' : 'text-muted-foreground/85'
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3 opacity-70" />
            ) : (
              <ChevronDown className="h-3 w-3 opacity-70" />
            )}
            <span>{label}</span>
          </span>
          <span className="font-mono text-[9.5px] font-normal text-muted-foreground/65">
            {items.length}
          </span>
        </button>

        {!isCollapsed && <div className="space-y-0.5">{items.map(renderConversationRow)}</div>}
      </div>
    );
  };

  const hasPoolIssues =
    !demoMode &&
    Boolean(
      keyPoolSummary &&
        keyPoolSummary.total > 0 &&
        (keyPoolSummary.cooldown > 0 || keyPoolSummary.invalid > 0)
    );
  const hasPoolInvalid = Boolean(keyPoolSummary && keyPoolSummary.invalid > 0);

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-[2px] md:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Collapsed Desktop Icon Rail */}
      {!open && (
        <aside className="hidden w-[52px] shrink-0 flex-col items-center justify-between border-r bg-card/90 py-2.5 md:flex">
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onToggleDesktop}
                  className="h-8 w-8 rounded-lg"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Buka Sidebar (Ctrl+B)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="icon" onClick={onNewChat} className="h-8 w-8 rounded-lg">
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New Chat (Ctrl+Shift+O)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onImportChat}
                  className="h-8 w-8 rounded-lg"
                >
                  <FileUp className="h-3.5 w-3.5 text-primary" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Import Chat (.json / .md)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onOpenCommandPalette}
                  className="h-8 w-8 rounded-lg"
                >
                  <Command className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Command Palette (Ctrl+K)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onOpenBookmarks}
                  className="h-8 w-8 rounded-lg"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Starred Answers</TooltipContent>
            </Tooltip>

            {onOpenDeviceControl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onOpenDeviceControl}
                    className="h-8 w-8 rounded-lg text-primary"
                  >
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Device Control (Desktop / HP)</TooltipContent>
              </Tooltip>
            )}

            {pinnedAll.length > 0 && (
              <>
                <Separator className="my-1 w-6" />
                {pinnedAll.map((pinConv) => {
                  const isPinActive = pinConv.id === activeId;
                  return (
                    <Tooltip key={pinConv.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onSelectConversation(pinConv.id)}
                          className={cn(
                            'flex h-7 w-7 items-center justify-center rounded-lg border text-[10px] font-bold uppercase transition-colors',
                            isPinActive
                              ? 'border-primary/60 bg-primary/15 text-primary'
                              : 'border-border/60 bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                          )}
                        >
                          {pinConv.title.trim().slice(0, 2) || 'P'}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <div className="flex items-center gap-1.5">
                          <Pin className="h-3 w-3 text-primary" />
                          <span className="max-w-[200px] truncate">{pinConv.title}</span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </>
            )}
          </div>

          <div className="flex flex-col items-center gap-1.5">
            {showInstallButton && onInstallApp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onInstallApp}
                    className="h-8 w-8 rounded-lg text-primary"
                  >
                    <MonitorDown className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Install Adam Studio App</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onCycleSkin}
                  className="h-8 w-8 rounded-lg"
                >
                  <Palette className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Ganti Theme Skin</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onOpenSettings}
                  className="relative h-8 w-8 rounded-lg"
                >
                  <Settings className="h-3.5 w-3.5" />
                  {hasPoolIssues && (
                    <span
                      className={cn(
                        'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
                        hasPoolInvalid ? 'bg-rose-400' : 'bg-amber-400'
                      )}
                    />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </div>
        </aside>
      )}

      {/* Expanded Sidebar (Mobile Drawer + Resizable Desktop IDE Sidebar) */}
      <aside
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[84vw] max-w-[320px] shrink-0 flex-col border-r bg-card/95 md:static md:max-w-none md:w-[var(--sidebar-w)]',
          !isResizing && 'transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          !open && 'md:hidden'
        )}
      >
        {/* Top IDE Header */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-bold leading-none tracking-tight">
                  Adam Studio
                </span>
                <span className="rounded border border-primary/30 bg-primary/10 px-1 py-0 font-mono text-[9px] font-semibold uppercase leading-[14px] text-primary">
                  IDE
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {conversations.length} sesi • {totalMessages} pesan
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onToggleDesktop}
                  className="hidden h-7 w-7 rounded-lg md:inline-flex"
                  aria-label="Ciutkan Sidebar"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Ciutkan ke Icon Rail (Ctrl+B)</TooltipContent>
            </Tooltip>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCloseMobile}
              className="h-7 w-7 rounded-lg md:hidden"
              aria-label="Tutup sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Action Bar + Search + Smart Filter Strip */}
        <div className="space-y-2 px-2.5 pb-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              onClick={() => {
                onNewChat();
                onCloseMobile();
              }}
              size="sm"
              className="h-8 flex-1 justify-between rounded-lg px-2.5 text-xs font-medium shadow-sm"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                <span>New Chat</span>
              </span>
              {sidebarWidth >= 255 && (
                <kbd className="hidden rounded bg-primary-foreground/15 px-1 py-0 font-mono text-[9px] font-normal text-primary-foreground/85 sm:inline-block">
                  ⌘⇧O
                </kbd>
              )}
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    onImportChat();
                    onCloseMobile();
                  }}
                  className="h-8 w-8 shrink-0 rounded-lg border-border/70 bg-background/50"
                  aria-label="Import Chat"
                >
                  <FileUp className="h-3.5 w-3.5 text-primary" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import Konteks Chat (.json / .md)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onOpenCommandPalette}
                  className="h-8 w-8 shrink-0 rounded-lg border-border/70 bg-background/50"
                  aria-label="Command Palette"
                >
                  <Command className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Command Palette (Ctrl+K)</TooltipContent>
            </Tooltip>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && search) {
                  e.stopPropagation();
                  setSearch('');
                }
              }}
              placeholder="Cari judul, isi, repo..."
              className="h-8 rounded-lg border-border/70 bg-background/65 pl-8 pr-7 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-1"
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Bersihkan pencarian"
              >
                <X className="h-3 w-3" />
              </button>
            ) : (
              <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 font-mono text-[9.5px] text-muted-foreground/55 sm:inline">
                ⌘K
              </span>
            )}
          </div>

          {/* Smart Filter Strip (Compact Pro IDE Horizontal Pills) */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filterTabs.map((tab) => {
              const active = filterTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={cn(
                    'relative isolate flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-medium transition-colors',
                    active
                      ? 'border-primary/40 text-primary-foreground'
                      : 'border-border/50 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground'
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-smart-filter-pill"
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      className="absolute inset-0 z-0 rounded-[5px] bg-primary shadow-sm"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                  {tab.count > 0 && (
                    <span
                      className={cn(
                        'relative z-10 font-mono text-[9px]',
                        active ? 'text-primary-foreground/85' : 'text-muted-foreground/70'
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Conversation List (Grouped 7 Hari Terakhir + Rich Session Cards) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 overscroll-contain">
          {filteredTotal === 0 ? (
            <div className="mx-1 my-4 rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
              {conversations.length === 0 ? (
                'Belum ada percakapan. Klik New Chat atau Import (.json / .md).'
              ) : (
                <div className="space-y-2">
                  <p>Tidak ada sesi yang cocok dengan filter atau kata kunci.</p>
                  {(search || filterTab !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setFilterTab('all');
                      }}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Reset filter & pencarian
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {renderSectionGroup('Disematkan', pinned, true)}
              {SIDEBAR_DATE_BUCKETS.map((bucket) =>
                renderSectionGroup(bucket, grouped[bucket], false)
              )}
            </div>
          )}
        </div>

        {/* Collapsible Usage & Status Footer */}
        <div className="shrink-0 border-t bg-card/90">
          {showInstallButton && onInstallApp && (
            <div className="border-b px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => {
                  onInstallApp();
                  onCloseMobile();
                }}
                className="flex w-full items-center justify-between rounded-lg border border-primary/35 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              >
                <span className="flex items-center gap-1.5">
                  <MonitorDown className="h-3.5 w-3.5" />
                  <span>Install Adam Studio</span>
                </span>
                <span className="rounded bg-primary/20 px-1.5 py-0 font-mono text-[9.5px]">
                  PWA
                </span>
              </button>
            </div>
          )}

          <AnimatePresence initial={false}>
            {footerExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="overflow-hidden border-b bg-background/45"
              >
                <div className="grid grid-cols-2 gap-1.5 p-2.5 text-[10.5px]">
                  <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
                      <Cpu className="h-3 w-3 text-primary" />
                      <span>Total Token</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] font-semibold text-foreground">
                      {totalTokens.toLocaleString()} tok
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
                      <Sparkles className="h-3 w-3 text-emerald-400" />
                      <span>Est. Biaya</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                      ${totalCost.toFixed(4)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onOpenSettings();
                      onCloseMobile();
                    }}
                    className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5 text-left transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
                      <KeyRound className="h-3 w-3 text-primary" />
                      <span>Key Pool</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] font-semibold">
                      {demoMode ? (
                        <span className="text-amber-400">Demo SSE</span>
                      ) : keyPoolSummary && keyPoolSummary.total > 0 ? (
                        <span
                          className={cn(
                            hasPoolInvalid
                              ? 'text-rose-400'
                              : hasPoolIssues
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                          )}
                        >
                          {keyPoolSummary.ready}/{keyPoolSummary.total} Ready
                        </span>
                      ) : (
                        <span className="text-foreground">
                          {activeKeyPoolCount > 0 ? `${activeKeyPoolCount} Keys` : 'Server/None'}
                        </span>
                      )}
                    </div>
                  </button>

                  <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
                      <Database className="h-3 w-3 text-sky-400" />
                      <span>Storage · Skin</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] font-medium capitalize text-foreground">
                      IDB · {skin}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Ultra-Compact Collapsible Footer Bar */}
          <div className="flex items-center justify-between gap-1 px-2 py-1.5">
            <button
              type="button"
              onClick={() => setFooterExpanded((prev) => !prev)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[10.5px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              title={footerExpanded ? 'Tutup detail pemakaian' : 'Lihat detail pemakaian & key pool'}
            >
              {footerExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate font-mono text-[10px]">
                {formatCompactTokens(totalTokens)} tok ·{' '}
                <span className="text-emerald-400">${totalCost.toFixed(3)}</span>
              </span>
              {hasPoolIssues && (
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    hasPoolInvalid ? 'bg-rose-400' : 'bg-amber-400'
                  )}
                  title="Periksa status API Key Pool"
                />
              )}
            </button>

            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      onOpenBookmarks();
                      onCloseMobile();
                    }}
                    className="h-7 w-7 rounded-lg"
                    aria-label="Starred Answers"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Starred Answers</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onCycleSkin}
                    className="h-7 w-7 rounded-lg"
                    aria-label="Ganti Theme Skin"
                  >
                    <Palette className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ganti Theme Skin ({skin})</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      onOpenSettings();
                      onCloseMobile();
                    }}
                    className="h-7 w-7 rounded-lg"
                    aria-label="Settings"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Settings & API Key Pool</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Desktop Drag-to-Resize Handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ubah lebar sidebar"
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          title="Tarik untuk ubah lebar • Double-klik untuk reset (280px)"
          className="group/resize absolute inset-y-0 -right-1 z-30 hidden w-2 cursor-col-resize touch-none select-none items-center justify-center md:flex"
        >
          <div
            className={cn(
              'h-full w-[2px] transition-colors',
              isResizing
                ? 'bg-primary shadow-[0_0_8px_hsl(var(--primary))]'
                : 'bg-transparent group-hover/resize:bg-primary/60'
            )}
          />
          {isResizing && (
            <div className="pointer-events-none fixed bottom-4 left-4 z-50 rounded-md border border-primary/40 bg-card/95 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary shadow-lg">
              {sidebarWidth}px
            </div>
          )}
        </div>
      </aside>
    </>
  );
});
