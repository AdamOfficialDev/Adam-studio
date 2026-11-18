import { CheckCircle2, Laptop, MonitorDown, Share, Smartphone } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface InstallAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isIos: boolean;
  canNativeInstall: boolean;
  onNativeInstall: () => void;
}

export function InstallAppDialog({
  open,
  onOpenChange,
  isIos,
  canNativeInstall,
  onNativeInstall,
}: InstallAppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <BrandLogo size="md" />
            <div>
              <DialogTitle>Install Adam Studio</DialogTitle>
              <DialogDescription className="mt-1">
                Jalankan sebagai aplikasi standalone seperti ChatGPT & Claude Desktop.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <div className="space-y-2 rounded-xl border bg-card/70 p-3.5">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Keuntungan App Mode</span>
            </div>
            <ul className="ml-6 list-disc space-y-1 text-muted-foreground">
              <li>Jendela terpisah tanpa address bar browser</li>
              <li>Loading instan & riwayat tetap tersedia saat offline</li>
              <li>Akses cepat dari Home Screen HP atau Taskbar / Dock PC</li>
            </ul>
          </div>

          {canNativeInstall ? (
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-3.5 text-foreground">
              Browser Anda mendukung instalasi instan 1-klik. Klik tombol{' '}
              <strong>Install Sekarang</strong> di bawah.
            </div>
          ) : isIos ? (
            <div className="space-y-2 rounded-xl border bg-muted/40 p-3.5">
              <div className="flex items-center gap-2 font-semibold">
                <Smartphone className="h-4 w-4 text-primary" />
                <span>Cara Install di iPhone / iPad (Safari)</span>
              </div>
              <ol className="ml-4 list-decimal space-y-1.5 text-muted-foreground">
                <li>
                  Tap tombol <strong>Share</strong> (<Share className="inline h-3.5 w-3.5" />) di
                  bar bawah Safari.
                </li>
                <li>
                  Gulir ke bawah lalu pilih <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong>Add</strong> di pojok kanan atas.
                </li>
              </ol>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border bg-muted/40 p-3.5">
              <div className="flex items-center gap-2 font-semibold">
                <Laptop className="h-4 w-4 text-primary" />
                <span>Cara Install di Chrome / Edge / Brave</span>
              </div>
              <p className="leading-relaxed text-muted-foreground">
                Klik ikon <strong>Install App</strong> di ujung kanan address bar browser, atau
                buka menu browser (<code>⋮</code>) lalu pilih{' '}
                <strong>Install Adam Studio / Add to Home screen</strong>. Pastikan situs diakses
                lewat <strong>HTTPS</strong> (Vercel) atau <code>localhost</code>.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Tutup
          </Button>
          {canNativeInstall && (
            <Button type="button" size="sm" onClick={onNativeInstall} className="gap-1.5 rounded-xl">
              <MonitorDown className="h-4 w-4" />
              Install Sekarang
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
