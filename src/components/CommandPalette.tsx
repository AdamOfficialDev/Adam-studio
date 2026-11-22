import {
  Bookmark,
  Cpu,
  Download,
  FileUp,
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
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Ketik perintah, cari chat, import konteks, atau template..." />
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

        {conversations.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Percakapan Terakhir">
              {conversations.slice(0, 8).map((conv) => (
                <CommandItem key={conv.id} onSelect={() => run(() => onSelectConversation(conv.id))}>
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
      <div className="studio-modal-footer flex items-center justify-between border-t border-border/70 px-3.5 py-2 text-[11px] text-muted-foreground">
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
  );
}
