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
      <DialogContent className="flex max-h-[90dvh] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="studio-modal-header shrink-0 border-b border-border/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandLogo size="md" />
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle>Install Adam Studio</DialogTitle>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
                  PWA
                </span>
              </div>
              <DialogDescription className="mt-0.5 text-xs">
                PWA Desktop & Mobile — standalone seperti native app.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-5 text-xs overscroll-contain sm:p-6">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border/75 bg-card/70 p-2.5 text-center">
              <Laptop className="mx-auto mb-1 h-4 w-4 text-primary" />
              <div className="font-semibold text-foreground">Standalone</div>
              <div className="text-[10px] text-muted-foreground">Tanpa URL bar</div>
            </div>
            <div className="rounded-xl border border-border/75 bg-card/70 p-2.5 text-center">
              <CheckCircle2 className="mx-auto mb-1 h-4 w-4 text-emerald-400" />
              <div className="font-semibold text-foreground">Offline Cache</div>
              <div className="text-[10px] text-muted-foreground">Akses instan</div>
            </div>
            <div className="rounded-xl border border-border/75 bg-card/70 p-2.5 text-center">
              <Smartphone className="mx-auto mb-1 h-4 w-4 text-primary" />
              <div className="font-semibold text-foreground">Dock / Home</div>
              <div className="text-[10px] text-muted-foreground">1-klik buka</div>
            </div>
          </div>

          {canNativeInstall ? (
            <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4 leading-relaxed text-foreground">
              Browser Anda mendukung instalasi instan 1-klik. Klik tombol{' '}
              <strong>Install Sekarang</strong> di bawah.
            </div>
          ) : isIos ? (
            <div className="space-y-2.5 rounded-2xl border border-border/75 bg-muted/35 p-4">
              <div className="flex items-center gap-2 font-semibold">
                <Smartphone className="h-4 w-4 text-primary" />
                <span>Cara Install di iPhone / iPad (Safari)</span>
              </div>
              <ol className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
                    1
                  </span>
                  <span>
                    Tap tombol <strong>Share</strong> (<Share className="inline h-3.5 w-3.5" />) di
                    bar bawah Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
                    2
                  </span>
                  <span>
                    Gulir ke bawah lalu pilih <strong>Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
                    3
                  </span>
                  <span>
                    Tap <strong>Add</strong> di pojok kanan atas.
                  </span>
                </li>
              </ol>
            </div>
          ) : (
            <div className="space-y-2 rounded-2xl border border-border/75 bg-muted/35 p-4">
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

        <DialogFooter className="studio-modal-footer shrink-0 border-t border-border/70 px-5 py-3.5 sm:px-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="rounded-xl px-4"
          >
            Tutup
          </Button>
          {canNativeInstall && (
            <Button
              type="button"
              size="sm"
              onClick={onNativeInstall}
              className="gap-1.5 rounded-xl px-4 shadow-sm shadow-primary/25"
            >
              <MonitorDown className="h-4 w-4" />
              Install Sekarang
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
