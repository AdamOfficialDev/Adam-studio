import { Keyboard, Smartphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUT_GROUPS: Array<{
  title: string;
  items: Array<{ keys: string[]; label: string }>;
}> = [
  {
    title: 'Navigasi & Workspace',
    items: [
      { keys: ['Ctrl', 'K'], label: 'Buka Command Palette & Full-Text Search' },
      { keys: ['Ctrl', 'B'], label: 'Toggle Sidebar / Icon Rail' },
      { keys: ['Ctrl', '\\'], label: 'Toggle Zen Focus Mode' },
      { keys: ['?'], label: 'Buka Daftar Shortcut Keyboard ini' },
    ],
  },
  {
    title: 'Chat & Composer',
    items: [
      { keys: ['Enter'], label: 'Kirim Pesan' },
      { keys: ['Shift', 'Enter'], label: 'Baris Baru (Newline)' },
      { keys: ['/'], label: 'Buka Slash Prompt Templates' },
      { keys: ['↑', '↓'], label: 'Navigasi Slash Templates / Command Palette' },
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <DialogHeader className="studio-modal-header border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Keyboard Shortcuts & Gestures</DialogTitle>
              <DialogDescription className="text-xs">
                Pintasan cepat untuk produktivitas di Adam Studio (gunakan ⌘ di macOS).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </div>
              <div className="divide-y divide-border/60 rounded-2xl border bg-card/60">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <span className="text-foreground/90">{item.label}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, idx) => (
                        <span key={`${item.label}-${k}`} className="inline-flex items-center gap-1">
                          <kbd className="rounded-md border border-border/80 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground shadow-sm">
                            {k}
                          </kbd>
                          {idx < item.keys.length - 1 && (
                            <span className="text-[10px] text-muted-foreground">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-start gap-2.5 rounded-2xl border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <span className="font-semibold text-foreground">Gesture Mobile:</span> Geser sidebar ke
              arah kiri untuk menutup drawer riwayat percakapan.
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
