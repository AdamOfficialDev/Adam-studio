import { memo, useMemo, useRef, useState, type TouchEvent } from 'react';
import { motion } from 'framer-motion';
import {
  Bookmark,
  Check,
  Command,
  FileUp,
  Layers,
  MessageSquare,
  MonitorDown,
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
import type { Conversation } from '@/types/chat';
import { cn } from '@/lib/utils';

type SidebarFilter = 'all' | 'pinned' | 'canvas';

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
  onCycleSkin: () => void;
  showInstallButton?: boolean;
  onInstallApp?: () => void;
}

function getDateBucket(timestamp: number): 'Hari Ini' | 'Kemarin' | 'Sebelumnya' {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  if (timestamp >= startOfToday) return 'Hari Ini';
  if (timestamp >= startOfYesterday) return 'Kemarin';
  return 'Sebelumnya';
}

function formatRelativeShort(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'baru saja';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}j`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'kemarin';
  if (diffDay < 7) return `${diffDay}h`;
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function shortModelTag(modelId: string): string {
  if (modelId === 'gemini-4-hydrogen') return 'H4';
  if (modelId === 'gemini-2.5-pro') return '2.5P';
  if (modelId === 'gemini-2.5-flash') return '2.5F';
  if (modelId === 'gemini-3.8-flash') return '2.0F';
  return modelId.replace(/^gemini-/i, '').slice(0, 8);
}

function convHasCanvas(conv: Conversation): boolean {
  return conv.messages.some(
    (m) =>
      m.role === 'assistant' &&
      /```(?:html|htm|svg|mermaid|[a-z]+\n[\s\S]{150,})/i.test(m.content)
  );
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
  onCycleSkin,
  showInstallButton = false,
  onInstallApp,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<SidebarFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const touchStartXRef = useRef<number | null>(null);

  const { totalTokens, totalCost, canvasIds } = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    const withCanvas = new Set<string>();
    for (const c of conversations) {
      if (convHasCanvas(c)) withCanvas.add(c.id);
      for (const m of c.messages) {
        if (m.usage?.totalTokenCount) tokens += m.usage.totalTokenCount;
        cost += estimateCostNumber(m.model || c.model, m.usage);
      }
    }
    return { totalTokens: tokens, totalCost: cost, canvasIds: withCanvas };
  }, [conversations]);

  const { pinned, grouped, filteredTotal } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = conversations
      .filter((c) => {
        const matchesTitle = c.title.toLowerCase().includes(q);
        const matchesContent =
          !matchesTitle &&
          Boolean(q) &&
          c.messages.some((m) => m.content && m.content.toLowerCase().includes(q));
        const matchesQuery = !q || matchesTitle || matchesContent;
        const matchesTab =
          filterTab === 'all' ||
          (filterTab === 'pinned' && Boolean(c.pinned)) ||
          (filterTab === 'canvas' && canvasIds.has(c.id));
        return matchesQuery && matchesTab;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const pinnedList = filtered.filter((c) => c.pinned);
    const regularList = filtered.filter((c) => !c.pinned);

    const groups: Record<'Hari Ini' | 'Kemarin' | 'Sebelumnya', Conversation[]> = {
      'Hari Ini': [],
      Kemarin: [],
      Sebelumnya: [],
    };

    for (const conv of regularList) {
      groups[getDateBucket(conv.updatedAt)].push(conv);
    }

    return {
      pinned: pinnedList,
      grouped: groups,
      filteredTotal: filtered.length,
    };
  }, [conversations, filterTab, search, canvasIds]);

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

  const renderConversationRow = (conv: Conversation) => {
    const isActive = conv.id === activeId;
    const isEditing = editingId === conv.id;
    const hasCanvas = canvasIds.has(conv.id);

    if (isEditing) {
      return (
        <div
          key={conv.id}
          className="flex items-center gap-1.5 rounded-xl border border-primary/50 bg-background/95 p-1.5 shadow-sm"
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
            className="h-7 flex-1 rounded-lg border-0 bg-muted/50 px-2 text-xs shadow-none focus-visible:ring-1"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commitRename(conv.id)}
            className="h-7 w-7 shrink-0 rounded-lg text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300"
            title="Simpan"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancelRename}
            className="h-7 w-7 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            title="Batal"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }

    return (
      <div
        key={conv.id}
        className={cn(
          'group relative flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors',
          isActive
            ? 'border-primary/35 bg-accent/90 text-accent-foreground shadow-sm'
            : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-accent/45 hover:text-foreground'
        )}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-1 top-2 w-0.5 rounded-full bg-primary"
          />
        )}

        <div className={cn('shrink-0', isActive && 'pl-1')}>
          {conv.pinned ? (
            <Pin className="h-3.5 w-3.5 text-primary" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5 opacity-65" />
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            onSelectConversation(conv.id);
            onCloseMobile();
          }}
          className="min-w-0 flex-1 text-left"
        >
          <div className={cn('truncate text-xs leading-snug', isActive && 'font-semibold')}>
            {conv.title}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="rounded bg-background/80 px-1 py-0 font-mono text-[9px]">
              {shortModelTag(conv.model)}
            </span>
            <span>•</span>
            <span>{formatRelativeShort(conv.updatedAt)}</span>
            {hasCanvas && (
              <>
                <span>•</span>
                <Layers className="h-2.5 w-2.5 text-primary" />
              </>
            )}
          </div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-opacity hover:bg-background/80 focus:opacity-100',
                isActive ? 'opacity-100' : 'opacity-80 md:opacity-0 md:group-hover:opacity-100'
              )}
              aria-label="Opsi percakapan"
            >
              <MoreHorizontal className="h-4 w-4" />
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
    );
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/65 md:hidden" onClick={onCloseMobile} />
      )}

      {!open && (
        <aside className="hidden w-14 shrink-0 flex-col items-center justify-between border-r bg-card/85 py-3 md:flex">
          <div className="flex flex-col items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onToggleDesktop}
                  className="rounded-xl"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Buka Sidebar (Ctrl+B)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="icon" onClick={onNewChat} className="rounded-xl">
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New Chat</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onImportChat}
                  className="rounded-xl"
                >
                  <FileUp className="h-4 w-4 text-primary" />
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
                  className="rounded-xl"
                >
                  <Command className="h-4 w-4" />
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
                  className="rounded-xl"
                >
                  <Bookmark className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Starred Answers</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-col items-center gap-2">
            {showInstallButton && onInstallApp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onInstallApp}
                    className="rounded-xl text-primary"
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
                  className="rounded-xl"
                >
                  <Palette className="h-4 w-4" />
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
                  className="rounded-xl"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </div>
        </aside>
      )}

      <aside
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[84vw] max-w-76 shrink-0 flex-col border-r bg-card transition-transform duration-200 md:static md:w-72',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          !open && 'md:hidden'
        )}
      >
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <BrandLogo size="sm" />
            <div>
              <div className="text-sm font-bold leading-none tracking-tight">Adam Studio</div>
              <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                AI Workspace
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleDesktop}
            className="hidden rounded-xl md:inline-flex"
            title="Ciutkan ke Icon Rail (Ctrl+B)"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCloseMobile}
            className="md:hidden"
            aria-label="Tutup sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2.5 px-3 pb-3">
          <div className="flex gap-1.5">
            <Button
              type="button"
              onClick={() => {
                onNewChat();
                onCloseMobile();
              }}
              className="flex-1 justify-start gap-2 rounded-xl shadow-sm"
            >
              <Plus className="h-4 w-4" />
              New Chat
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
                  className="h-9 w-9 shrink-0 rounded-xl border-border/80"
                  aria-label="Import Chat"
                >
                  <FileUp className="h-4 w-4 text-primary" />
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
                  className="h-9 w-9 shrink-0 rounded-xl border-border/80"
                  aria-label="Command Palette"
                >
                  <Command className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Command Palette (Ctrl+K)</TooltipContent>
            </Tooltip>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari riwayat chat..."
              className="h-8 rounded-xl bg-background/60 pl-8 pr-8 text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Perbaikan Kontras Pill Aktif (isolate + z-0/z-10, bukan -z-10) */}
          <div className="grid grid-cols-3 gap-1 rounded-xl border bg-background/60 p-1">
            {(
              [
                { id: 'all', label: 'Semua' },
                { id: 'pinned', label: 'Pin' },
                { id: 'canvas', label: 'Canvas' },
              ] as const
            ).map((tab) => {
              const active = filterTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={cn(
                    'relative isolate rounded-lg py-1 text-[11px] font-semibold transition-colors',
                    active
                      ? 'text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-filter-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 z-0 rounded-lg bg-primary shadow-sm"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Separator />

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5 overscroll-contain">
          {filteredTotal === 0 ? (
            <div className="rounded-xl border border-dashed px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">
              {conversations.length === 0
                ? 'Belum ada percakapan. Klik New Chat atau Import (.json / .md).'
                : 'Tidak ada percakapan yang cocok dengan filter atau pencarian.'}
            </div>
          ) : (
            <div className="space-y-4">
              {pinned.length > 0 && (
                <div className="space-y-1">
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                    Disematkan
                  </div>
                  {pinned.map(renderConversationRow)}
                </div>
              )}

              {(['Hari Ini', 'Kemarin', 'Sebelumnya'] as const).map((label) => {
                const items = grouped[label];
                if (items.length === 0) return null;

                return (
                  <div key={label} className="space-y-1">
                    <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </div>
                    {items.map(renderConversationRow)}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showInstallButton && onInstallApp && (
          <div className="mx-3 mb-2">
            <button
              type="button"
              onClick={() => {
                onInstallApp();
                onCloseMobile();
              }}
              className="flex w-full items-center justify-between rounded-xl border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <span className="flex items-center gap-2">
                <MonitorDown className="h-4 w-4" />
                <span>Install App</span>
              </span>
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px]">PWA</span>
            </button>
          </div>
        )}

        <div className="mx-3 mb-2 space-y-1.5 rounded-xl border bg-background/60 p-3 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-medium text-muted-foreground">
              {conversations.length} Sesi Tersimpan
            </span>
            <span className="font-mono text-emerald-400">${totalCost.toFixed(4)}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Total Pemakaian</span>
            <span className="font-mono text-foreground">{totalTokens.toLocaleString()} tok</span>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-1 p-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenSettings();
              onCloseMobile();
            }}
            className="flex-1 justify-start gap-2 rounded-xl text-xs"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              onOpenBookmarks();
              onCloseMobile();
            }}
            className="rounded-xl"
            title="Starred Answers"
          >
            <Bookmark className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCycleSkin}
            className="rounded-xl"
            title="Ganti Theme Skin"
          >
            <Palette className="h-4 w-4" />
          </Button>
        </div>
      </aside>
    </>
  );
});
