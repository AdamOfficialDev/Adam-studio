import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Cpu,
  Download,
  FileUp,
  Keyboard,
  Maximize2,
  MessageSquare,
  MonitorDown,
  Palette,
  Plus,
  Settings,
  Sparkles,
  Terminal,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { SLASH_PROMPTS } from '@/lib/personas';
import type { Conversation, ThemeSkin } from '@/types/chat';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  activeSkin: ThemeSkin;
  onNewChat: () => void;
  onImportChat: () => void;
  onSelectConversation: (id: string) => void;
  onOpenModelSelector: () => void;
  onOpenSettings: () => void;
  onOpenBookmarks: () => void;
  onToggleZenMode: () => void;
  onCycleSkin: () => void;
  onExportMarkdown: () => void;
  onInsertTemplate: (template: string) => void;
  showInstallOption?: boolean;
  onInstallApp?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  conversations,
  activeSkin,
  onNewChat,
  onImportChat,
  onSelectConversation,
  onOpenModelSelector,
  onOpenSettings,
  onOpenBookmarks,
  onToggleZenMode,
  onCycleSkin,
  onExportMarkdown,
  onInsertTemplate,
  showInstallOption = false,
  onInstallApp,
}: CommandPaletteProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (open) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!shortcutsOpen && document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setShortcutsOpen((prev) => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, shortcutsOpen]);

  const searchableConversations = useMemo(() => {
    const pool = query.trim() ? conversations : conversations.slice(0, 8);
    return pool.map((conv) => {
      const corpus = conv.messages
        .slice(-12)
        .map((m) => m.content)
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 420);
      return { conv, corpus };
    });
  }, [conversations, query]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Ketik perintah, cari judul/isi chat, atau template..."
      />
      <CommandList>
        <CommandEmpty>Tidak ada perintah atau chat yang cocok.</CommandEmpty>

        <CommandGroup heading="Aksi Workspace">
          <CommandItem onSelect={() => run(onNewChat)}>
            <Plus className="text-primary" />
            <span>Buat Percakapan Baru</span>
            <CommandShortcut>Ctrl+Shift+O</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(onImportChat)}>
            <FileUp className="text-primary" />
            <span>Import Konteks Chat (.json / .md)</span>
          </CommandItem>
          {showInstallOption && onInstallApp && (
            <CommandItem onSelect={() => run(onInstallApp)}>
              <MonitorDown className="text-primary" />
              <span>Install Adam Studio sebagai Aplikasi (PWA)</span>
            </CommandItem>
          )}
          <CommandItem onSelect={() => run(onOpenModelSelector)}>
            <Cpu className="text-primary" />
            <span>Pilih Model (Gemini 4 Hydrogen / Custom)</span>
          </CommandItem>
          <CommandItem onSelect={() => run(onToggleZenMode)}>
            <Maximize2 className="text-primary" />
            <span>Toggle Zen Focus Mode</span>
            <CommandShortcut>Ctrl+\</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(onCycleSkin)}>
            <Palette className="text-primary" />
            <span>Ganti Theme Skin (Aktif: {activeSkin})</span>
          </CommandItem>
          <CommandItem onSelect={() => run(onOpenBookmarks)}>
            <Bookmark className="text-amber-400" />
            <span>Buka Starred / Bookmarked Pesan</span>
          </CommandItem>
          <CommandItem onSelect={() => run(onExportMarkdown)}>
            <Download />
            <span>Export Percakapan Aktif (.md)</span>
          </CommandItem>
          <CommandItem onSelect={() => run(onOpenSettings)}>
            <Settings />
            <span>Buka Workspace Settings & API Key</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => setShortcutsOpen(true))}>
            <Keyboard className="text-primary" />
            <span>Daftar Shortcut Keyboard & Gestures</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Slash Prompt Templates">
          {SLASH_PROMPTS.map((tpl) => (
            <CommandItem key={tpl.command} onSelect={() => run(() => onInsertTemplate(tpl.template))}>
              <Terminal className="text-primary" />
              <div className="flex flex-col">
                <span className="font-medium">{tpl.title}</span>
                <span className="text-[11px] text-muted-foreground">{tpl.description}</span>
              </div>
              <CommandShortcut>{tpl.command}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        {searchableConversations.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup
              heading={query.trim() ? 'Hasil Pencarian Percakapan' : 'Percakapan Terakhir'}
            >
              {searchableConversations.map(({ conv, corpus }) => (
                <CommandItem
                  key={conv.id}
                  value={`${conv.title} ${conv.id}`}
                  keywords={[conv.model, corpus]}
                  onSelect={() => run(() => onSelectConversation(conv.id))}
                >
                  <MessageSquare className="text-muted-foreground" />
                  <span className="truncate">{conv.title}</span>
                  <CommandShortcut className="flex items-center gap-1">
                    <Sparkles className="h-2.5 w-2.5 text-primary" />
                    {conv.model}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="studio-modal-footer flex items-center justify-between border-t border-border/75 px-5 py-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-border/70 bg-muted/65 px-1 py-0.5 font-mono text-[10px]">
              ↑↓
            </kbd>
            <span>Navigasi</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-border/70 bg-muted/65 px-1 py-0.5 font-mono text-[10px]">
              ↵
            </kbd>
            <span>Pilih</span>
          </span>
        </div>
        <span className="font-mono text-[10px] opacity-80">Adam Studio Command Bar</span>
      </div>
    </CommandDialog>
    </>
  );
}
