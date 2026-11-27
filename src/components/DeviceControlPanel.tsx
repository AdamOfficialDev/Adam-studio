import { memo, useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Download,
  Hand,
  Laptop,
  Loader2,
  MonitorSmartphone,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StudioScroll } from '@/components/ui/studio-scroll';
import { cn } from '@/lib/utils';
import type {
  DeviceActionLog,
  DeviceApprovalMode,
  DeviceApprovalRequest,
  DeviceInfo,
  DevicePlatform,
  DeviceScreenFrame,
} from '@/types/chat';

interface DeviceControlPanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDeviceId: string | null;
  onSelectDeviceId: (id: string | null) => void;
  latestFrame: DeviceScreenFrame | null;
  onFrameUpdate: (frame: DeviceScreenFrame | null) => void;
  pendingApproval: DeviceApprovalRequest | null;
  onClearApproval: () => void;
  actionLogs: DeviceActionLog[];
  approvalMode: DeviceApprovalMode;
  onChangeApprovalMode: (mode: DeviceApprovalMode) => void;
  isStreaming: boolean;
  onStopAi: () => void;
  onSendQuickCommand?: (prompt: string) => void;
}

const APPROVAL_MODE_OPTIONS: Array<{
  id: DeviceApprovalMode;
  label: string;
  desc: string;
}> = [
  { id: 'high-risk', label: 'High-Risk Ask', desc: 'Konfirmasi saat ketik/terminal/aksi sensitif' },
  { id: 'always', label: 'Always Ask', desc: 'Konfirmasi setiap klik, tap, & ketik' },
  { id: 'autonomous', label: 'Autonomous', desc: 'Eksekusi otomatis tanpa konfirmasi' },
];

export const DeviceControlPanel = memo(function DeviceControlPanel({
  isOpen,
  onClose,
  selectedDeviceId,
  onSelectDeviceId,
  latestFrame,
  onFrameUpdate,
  pendingApproval,
  onClearApproval,
  actionLogs,
  approvalMode,
  onChangeApprovalMode,
  isStreaming,
  onStopAi,
  onSendQuickCommand,
}: DeviceControlPanelProps) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [sharedStore, setSharedStore] = useState<boolean | null>(null);
  const [shellKind, setShellKind] = useState<'bash' | 'powershell' | 'repo'>(() =>
    typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
      ? 'powershell'
      : 'bash'
  );
  const [androidMode, setAndroidMode] = useState<'apk' | 'adb'>('apk');
  const [copiedApkConfig, setCopiedApkConfig] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [showPairWizard, setShowPairWizard] = useState(false);
  const [pairPlatform, setPairPlatform] = useState<DevicePlatform>('desktop');
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null);
  const [creatingPair, setCreatingPair] = useState(false);
  const [resolvingApproval, setResolvingApproval] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [bypassSecret, setBypassSecret] = useState('');

  const fetchDevices = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingDevices(true);
      try {
        const res = await fetch('/api/device?action=list');
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          devices?: DeviceInfo[];
          sharedStore?: boolean;
        };
        if (typeof data.sharedStore === 'boolean') {
          setSharedStore(data.sharedStore);
        }
        if (data.ok && Array.isArray(data.devices)) {
          setDevices(data.devices);
          if (!selectedDeviceId && data.devices.length > 0) {
            const preferred = data.devices.find((d) => d.status !== 'offline') || data.devices[0];
            onSelectDeviceId(preferred.id);
          } else if (
            selectedDeviceId &&
            !data.devices.some((d) => d.id === selectedDeviceId)
          ) {
            onSelectDeviceId(data.devices[0]?.id ?? null);
          }
        }
      } catch {
        // Abaikan error polling jaringan sementara
      } finally {
        if (!silent) setLoadingDevices(false);
      }
    },
    [onSelectDeviceId, selectedDeviceId]
  );

  const fetchLatestFrame = useCallback(
    async (deviceId: string) => {
      try {
        const res = await fetch(
          `/api/device?action=frame&deviceId=${encodeURIComponent(deviceId)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          frame?: DeviceScreenFrame | null;
        };
        if (data.ok && data.frame) {
          onFrameUpdate(data.frame);
        }
      } catch {
        // Abaikan
      }
    },
    [onFrameUpdate]
  );

  useEffect(() => {
    if (!isOpen) return;
    void fetchDevices(false);
    const id = window.setInterval(() => {
      void fetchDevices(true);
    }, 3500);
    return () => window.clearInterval(id);
  }, [isOpen, fetchDevices]);

  useEffect(() => {
    if (!isOpen || !selectedDeviceId) return;
    void fetchLatestFrame(selectedDeviceId);
    const id = window.setInterval(() => {
      if (!isStreaming) void fetchLatestFrame(selectedDeviceId);
    }, 4500);
    return () => window.clearInterval(id);
  }, [isOpen, selectedDeviceId, isStreaming, fetchLatestFrame]);

  if (!isOpen) return null;

  const activeDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const isPaused = activeDevice?.status === 'paused';

  const handleCreatePair = async (platform: DevicePlatform) => {
    setPairPlatform(platform);
    setCreatingPair(true);
    try {
      const res = await fetch('/api/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-pair', platform }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        pairCode?: string;
        code?: string;
        expiresAt?: number;
        message?: string;
      };
      const code = data.pairCode || data.code || null;
      if (res.ok && data.ok && code) {
        setPairCode(code);
        setPairExpiresAt(data.expiresAt ?? Date.now() + 300_000);
        setShowPairWizard(true);
      } else {
        toast.error(data.message || 'Gagal membuat kode pairing');
      }
    } catch {
      toast.error('Tidak dapat terhubung ke /api/device');
    } finally {
      setCreatingPair(false);
    }
  };

  const handleRegisterSimulator = async (platform: DevicePlatform) => {
    try {
      const simId = platform === 'android' ? 'sim-android-1' : 'sim-desktop-1';
      const res = await fetch('/api/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          deviceId: simId,
          name:
            platform === 'android'
              ? 'Android Pixel Simulator'
              : 'Desktop Workstation Simulator',
          platform,
          os: platform === 'android' ? 'Android 15 (Virtual)' : 'Linux Desktop (Virtual)',
          screenWidth: platform === 'android' ? 540 : 1280,
          screenHeight: platform === 'android' ? 1140 : 720,
          isSimulator: true,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; device?: DeviceInfo; message?: string };
      if (res.ok && data.ok) {
        onSelectDeviceId(data.device?.id || simId);
        setShowPairWizard(false);
        await fetchDevices(true);
        toast.success(
          `${platform === 'android' ? 'Android' : 'Desktop'} Simulator aktif & siap dikendalikan AI!`
        );
      } else {
        toast.error(data.message || 'Gagal mengaktifkan simulator');
      }
    } catch {
      toast.error('Gagal mendaftarkan simulator');
    }
  };

  const handleTogglePause = async () => {
    if (!activeDevice) return;
    setTogglingPause(true);
    try {
      const nextPaused = !isPaused;
      const res = await fetch('/api/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pause',
          deviceId: activeDevice.id,
          paused: nextPaused,
        }),
      });
      if (res.ok) {
        if (nextPaused && isStreaming) onStopAi();
        await fetchDevices(true);
        toast.success(
          nextPaused
            ? 'Kontrol AI dijeda (Take Over Manual aktif)'
            : 'Kontrol AI dilanjutkan kembali'
        );
      }
    } catch {
      toast.error('Gagal mengubah status jeda device');
    } finally {
      setTogglingPause(false);
    }
  };

  const handleRemoveDevice = async (deviceId: string) => {
    try {
      const res = await fetch('/api/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', deviceId }),
      });
      if (res.ok) {
        if (selectedDeviceId === deviceId) onFrameUpdate(null);
        await fetchDevices(true);
        toast.success('Device dilepaskan dari hub');
      }
    } catch {
      toast.error('Gagal menghapus device');
    }
  };

  const handleResolveApproval = async (approved: boolean) => {
    if (!pendingApproval) return;
    setResolvingApproval(true);
    try {
      const res = await fetch('/api/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve-approval',
          approvalId: pendingApproval.approvalId,
          approved,
        }),
      });
      if (res.ok) {
        onClearApproval();
        toast.success(approved ? 'Aksi disetujui & dieksekusi' : 'Aksi ditolak');
      } else {
        toast.error('Gagal mengirim keputusan approval');
      }
    } catch {
      toast.error('Koneksi approval gagal');
    } finally {
      setResolvingApproval(false);
    }
  };

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
  const hostName = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const isLocalHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(hostName);
  const isVercelPreviewHost = /-git-|-[a-z0-9]{6,}-projects\.vercel\.app$/i.test(hostName);
  const needsSharedStoreWarning = sharedStore === false && !isLocalHost;
  const cleanBypass = bypassSecret.trim();
  const bridgeDownloadUrl = `${originUrl}/api/device?action=bridge-script`;
  const psHeaderArg = cleanBypass
    ? ` -Headers @{"x-vercel-protection-bypass"="${cleanBypass}"}`
    : '';
  const curlHeaderArg = cleanBypass
    ? ` -H "x-vercel-protection-bypass: ${cleanBypass}"`
    : '';
  const nodeBypassArg = cleanBypass ? ` --bypass "${cleanBypass}"` : '';
  const bridgeCommand = !pairCode
    ? ''
    : shellKind === 'powershell'
      ? `$s = irm "${bridgeDownloadUrl}"${psHeaderArg}; if ($s -match '^\\s*<') { throw "Terblokir Vercel Deployment Protection (HTML). Pakai Production URL atau isi Bypass Secret." }; [IO.File]::WriteAllText((Join-Path $PWD 'adam-device-bridge.mjs'), $s); node adam-device-bridge.mjs --server ${originUrl} --pair ${pairCode} --platform ${pairPlatform}${nodeBypassArg}`
      : shellKind === 'bash'
        ? `curl -fsSL${curlHeaderArg} "${bridgeDownloadUrl}" -o adam-device-bridge.mjs && ! head -n 1 adam-device-bridge.mjs | grep -q '^<' && node adam-device-bridge.mjs --server ${originUrl} --pair ${pairCode} --platform ${pairPlatform}${nodeBypassArg}`
        : `node companion/adam-device-bridge.mjs --server ${originUrl} --pair ${pairCode} --platform ${pairPlatform}${nodeBypassArg}`;

  const copyCommand = async () => {
    if (!bridgeCommand) return;
    try {
      await navigator.clipboard.writeText(bridgeCommand);
      setCopiedCmd(true);
      toast.success('Perintah Bridge disalin!');
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      toast.error('Gagal menyalin perintah');
    }
  };

  const apkReleaseUrl =
    'https://github.com/AdamOfficialDev/Adam-studio/releases/download/android-companion-latest/adam-device-companion.apk';
  const apkActionsUrl =
    'https://github.com/AdamOfficialDev/Adam-studio/actions/workflows/build-android-apk.yml';

  const copyApkConfig = async () => {
    if (!pairCode) return;
    const payload: Record<string, string> = {
      server: originUrl,
      pair: pairCode,
    };
    if (cleanBypass) payload.bypass = cleanBypass;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setCopiedApkConfig(true);
      toast.success('Config APK disalin! Buka Adam Companion di HP lalu ketuk "Paste Config".');
      setTimeout(() => setCopiedApkConfig(false), 2000);
    } catch {
      toast.error('Gagal menyalin konfigurasi APK');
    }
  };

  const activeScreenFrame =
    latestFrame && (!activeDevice || latestFrame.deviceId === activeDevice.id)
      ? latestFrame
      : null;

  return (
    <aside className="fixed inset-0 z-40 flex h-full w-full flex-col border-l bg-background lg:static lg:w-[44vw] lg:min-w-[380px] lg:max-w-[66vw] lg:shrink-0">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-card/90 px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/35 bg-primary/15 text-primary">
            <MonitorSmartphone className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-bold tracking-tight sm:text-sm">
                Device Control
              </span>
              {activeDevice && (
                <Badge
                  variant="outline"
                  className={cn(
                    'px-1.5 py-0 text-[10px]',
                    activeDevice.status === 'online'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : activeDevice.status === 'busy'
                        ? 'border-sky-500/40 bg-sky-500/10 text-sky-400'
                        : activeDevice.status === 'paused'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                          : 'border-border text-muted-foreground'
                  )}
                >
                  {activeDevice.isSimulator ? 'SIM' : activeDevice.status.toUpperCase()}
                </Badge>
              )}
            </div>
            <p className="truncate text-[10px] text-muted-foreground">
              {activeDevice
                ? `${activeDevice.name} (${activeDevice.screenWidth}×${activeDevice.screenHeight})`
                : 'Belum ada perangkat terhubung'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setShowPairWizard((s) => !s);
              if (!pairCode) void handleCreatePair(pairPlatform);
            }}
            className="h-8 gap-1 rounded-xl px-2.5 text-xs"
            title="Hubungkan Device Baru"
          >
            <Plus className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">Pair</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              void fetchDevices(false);
              if (selectedDeviceId) void fetchLatestFrame(selectedDeviceId);
            }}
            className="h-8 w-8 rounded-xl"
            title="Refresh Device & Layar"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loadingDevices && 'animate-spin')} />
          </Button>

          {activeDevice && (
            <Button
              type="button"
              variant={isPaused ? 'secondary' : 'outline'}
              size="sm"
              disabled={togglingPause}
              onClick={() => void handleTogglePause()}
              className={cn(
                'h-8 gap-1 rounded-xl px-2.5 text-xs',
                isPaused && 'border-amber-500/45 bg-amber-500/15 text-amber-300'
              )}
              title={isPaused ? 'Lanjutkan kontrol AI' : 'Take Over Manual (Jeda AI)'}
            >
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <Hand className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isPaused ? 'Resume' : 'Take Over'}</span>
            </Button>
          )}

          {isStreaming && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onStopAi}
              className="h-8 gap-1 rounded-xl px-2.5 text-xs"
              title="Emergency Kill Switch"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>Stop</span>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-xl"
            aria-label="Tutup Device Control"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Connected Device Selector Strip */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/25 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {devices.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              Klik <strong>Pair</strong> atau aktifkan <strong>Simulator</strong> untuk mulai.
            </span>
          ) : (
            devices.map((dev) => {
              const active = dev.id === selectedDeviceId;
              const Icon = dev.platform === 'android' ? Smartphone : Laptop;
              return (
                <div
                  key={dev.id}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition-colors',
                    active
                      ? 'border-primary/50 bg-primary/15 text-foreground'
                      : 'border-border/70 bg-card/70 text-muted-foreground hover:text-foreground'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDeviceId(dev.id)}
                    className="flex items-center gap-1.5"
                  >
                    <Icon className="h-3.5 w-3.5 text-primary" />
                    <span className="max-w-[130px] truncate font-medium">{dev.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemoveDevice(dev.id)}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    title="Putuskan device"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <select
          value={approvalMode}
          onChange={(e) => onChangeApprovalMode(e.target.value as DeviceApprovalMode)}
          className="h-7 shrink-0 rounded-lg border bg-card px-2 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          title="Kebijakan keamanan eksekusi AI"
        >
          {APPROVAL_MODE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Main Scrollable Content */}
      <StudioScroll className="min-h-0 flex-1" autoHide="scroll">
        <div className="space-y-4 p-3.5">
          {/* Human-in-the-Loop Approval Banner */}
          {pendingApproval && (
            <div className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-3.5 shadow-lg">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-amber-300">
                      Persetujuan Keamanan Diperlukan
                    </span>
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 font-mono text-[10px] uppercase text-amber-300"
                    >
                      {pendingApproval.riskLevel} risk
                    </Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-foreground">
                    {pendingApproval.summary}
                  </p>
                  <pre className="max-h-24 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] text-zinc-200">
                    {pendingApproval.toolName}({JSON.stringify(pendingApproval.args)})
                  </pre>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      disabled={resolvingApproval}
                      onClick={() => void handleResolveApproval(true)}
                      className="h-7 gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-500"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Izinkan Aksi
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={resolvingApproval}
                      onClick={() => void handleResolveApproval(false)}
                      className="h-7 gap-1.5 rounded-lg px-3 text-xs"
                    >
                      <X className="h-3.5 w-3.5" />
                      Tolak
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pairing Wizard */}
          {showPairWizard && (
            <div className="space-y-3 rounded-2xl border border-primary/35 bg-card/85 p-3.5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-primary" />
                  <span className="text-xs font-bold">Hubungkan Device (Companion Bridge)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPairWizard(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreatePair('desktop')}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-colors',
                    pairPlatform === 'desktop'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-accent'
                  )}
                >
                  <Laptop className="h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold">Desktop PC</div>
                    <div className="text-[10px] text-muted-foreground">Win / macOS / Linux</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreatePair('android')}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-colors',
                    pairPlatform === 'android'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'hover:bg-accent'
                  )}
                >
                  <Smartphone className="h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold">Android HP</div>
                    <div className="text-[10px] text-muted-foreground">Via ADB Wireless / USB</div>
                  </div>
                </button>
              </div>

              {isVercelPreviewHost && !cleanBypass && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] leading-relaxed text-rose-200">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                  <div className="space-y-1">
                    <div>
                      <strong>Vercel Preview Protection Aktif:</strong> URL preview (
                      <code className="rounded bg-black/40 px-1 font-mono text-[10px]">
                        *-git-*.vercel.app
                      </code>
                      ) memblokir <code className="font-mono text-[10px]">irm</code> &amp;{' '}
                      <code className="font-mono text-[10px]">node</code> dengan halaman login HTML.
                    </div>
                    <div className="text-[10px] text-rose-200/90">
                      Solusi: (1) Buka lewat <strong>Production URL</strong> (setelah merge ke{' '}
                      <code className="font-mono">main</code>), atau (2) Matikan{' '}
                      <strong>Vercel Authentication</strong> di Vercel → Settings → Deployment
                      Protection, atau (3) Isi <strong>Bypass Secret</strong> di bawah.
                    </div>
                  </div>
                </div>
              )}

              {!isLocalHost && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-medium text-muted-foreground">
                    Vercel Protection Bypass Secret (opsional, khusus Preview URL terproteksi):
                  </label>
                  <input
                    type="password"
                    value={bypassSecret}
                    onChange={(e) => setBypassSecret(e.target.value)}
                    placeholder="Tempel x-vercel-protection-bypass jika pakai Preview URL..."
                    className="h-7 w-full rounded-lg border bg-background px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}

              {needsSharedStoreWarning && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <div>
                    <strong>Serverless Tanpa Redis Terdeteksi:</strong> Agar pairing bridge &amp;
                    frame layar sinkron lintas-instance di Vercel, set{' '}
                    <code className="rounded bg-black/40 px-1 font-mono text-[10px]">
                      UPSTASH_REDIS_REST_URL
                    </code>{' '}
                    &amp;{' '}
                    <code className="rounded bg-black/40 px-1 font-mono text-[10px]">
                      UPSTASH_REDIS_REST_TOKEN
                    </code>{' '}
                    di Environment Variables Vercel, atau jalankan secara lokal dengan{' '}
                    <code className="rounded bg-black/40 px-1 font-mono text-[10px]">pnpm dev</code>.
                  </div>
                </div>
              )}

              {creatingPair ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>Membuat pairing token...</span>
                </div>
              ) : pairCode ? (
                <div className="space-y-2.5 rounded-xl border bg-background/80 p-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Kode Pairing:</span>
                    <div className="flex items-center gap-2">
                      {pairPlatform === 'desktop' || androidMode === 'adb' ? (
                        <a
                          href={bridgeDownloadUrl}
                          download="adam-device-bridge.mjs"
                          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-card px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent"
                          title="Unduh file bridge standalone agar bisa dijalankan dari folder mana saja"
                        >
                          <Download className="h-3 w-3 text-primary" />
                          Unduh .mjs
                        </a>
                      ) : null}
                      <span className="font-mono font-bold tracking-widest text-primary">
                        {pairCode}
                      </span>
                    </div>
                  </div>

                  {pairPlatform === 'android' && (
                    <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted/60 p-1 text-[10px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setAndroidMode('apk')}
                        className={cn(
                          'rounded-md py-1 transition-colors',
                          androidMode === 'apk'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        APK Android (Tanpa PC)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAndroidMode('adb')}
                        className={cn(
                          'rounded-md py-1 transition-colors',
                          androidMode === 'adb'
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Via ADB (PC / Termux)
                      </button>
                    </div>
                  )}

                  {pairPlatform === 'android' && androidMode === 'apk' ? (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <a
                          href={apkReleaseUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download APK
                        </a>
                        <button
                          type="button"
                          onClick={() => void copyApkConfig()}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                        >
                          {copiedApkConfig ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {copiedApkConfig ? 'Config Disalin!' : 'Salin Config APK'}
                        </button>
                      </div>

                      <div className="space-y-1 rounded-lg border border-border/60 bg-card/60 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
                        <div>
                          <strong className="text-foreground">1.</strong> Install{' '}
                          <code className="font-mono text-foreground">adam-device-companion.apk</code>{' '}
                          di HP Android (dibangun otomatis oleh GitHub Actions —{' '}
                          <a
                            href={apkActionsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            cek status build
                          </a>
                          ).
                        </div>
                        <div>
                          <strong className="text-foreground">2.</strong> Buka aplikasi{' '}
                          <strong className="text-foreground">Adam Companion</strong>, ketuk{' '}
                          <strong className="text-foreground">Paste Config</strong> untuk isi URL &amp;
                          kode <code className="font-mono text-primary">{pairCode}</code> otomatis.
                        </div>
                        <div>
                          <strong className="text-foreground">3.</strong> Aktifkan izin{' '}
                          <strong className="text-foreground">Accessibility Control</strong> (Android
                          13+: buka Info App → <code className="font-mono">⋮</code> → Allow restricted
                          settings), lalu tekan <strong className="text-foreground">Start AI Device Control</strong>.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Terminal className="h-3 w-3" />
                            Jalankan di terminal:
                          </span>
                          <div className="flex items-center gap-1">
                            {(['powershell', 'bash', 'repo'] as const).map((kind) => (
                              <button
                                key={kind}
                                type="button"
                                onClick={() => setShellKind(kind)}
                                className={cn(
                                  'rounded px-1.5 py-0.5 font-medium transition-colors',
                                  shellKind === kind
                                    ? 'bg-primary/20 text-primary'
                                    : 'hover:bg-muted hover:text-foreground'
                                )}
                              >
                                {kind === 'powershell'
                                  ? 'PowerShell'
                                  : kind === 'bash'
                                    ? 'Bash/Mac'
                                    : 'Folder Repo'}
                              </button>
                            ))}
                            {pairExpiresAt && (
                              <span className="ml-1">
                                ({Math.max(1, Math.round((pairExpiresAt - Date.now()) / 60_000))}m)
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-lg border bg-zinc-950 p-2">
                          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-emerald-300">
                            {bridgeCommand}
                          </code>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => void copyCommand()}
                            className="h-7 w-7 shrink-0 text-zinc-300 hover:bg-zinc-800"
                          >
                            {copiedCmd ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        {shellKind === 'repo'
                          ? 'Mode Folder Repo wajib dijalankan dari dalam direktori root proyek Adam-studio. Gunakan tab PowerShell / Bash agar skrip terunduh otomatis dan bisa jalan dari folder mana saja.'
                          : pairPlatform === 'android'
                            ? 'Perintah di atas otomatis mengunduh adam-device-bridge.mjs lalu menyambungkan HP Android via ADB (`adb devices` / `adb connect`).'
                            : 'Perintah di atas otomatis mengunduh adam-device-bridge.mjs ke folder aktif dan langsung menyambungkan Desktop PC kamu.'}
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-[11px]">
                <span className="text-muted-foreground">Ingin langsung coba tanpa CLI?</span>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRegisterSimulator('desktop')}
                    className="h-7 rounded-lg px-2.5 text-[11px]"
                  >
                    Desktop Sim
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRegisterSimulator('android')}
                    className="h-7 rounded-lg px-2.5 text-[11px]"
                  >
                    Android Sim
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Live Screen Viewport */}
          <div className="overflow-hidden rounded-2xl border bg-zinc-950 shadow-inner">
            <div className="flex items-center justify-between border-b border-zinc-800/90 bg-zinc-900/90 px-3 py-1.5 text-[11px] text-zinc-300">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    isStreaming
                      ? 'animate-pulse bg-emerald-400'
                      : activeDevice
                        ? 'bg-sky-400'
                        : 'bg-zinc-600'
                  )}
                />
                <span className="font-medium">
                  {activeScreenFrame?.actionLabel ||
                    (activeDevice ? 'Live Screen Feed' : 'Menunggu Koneksi Device')}
                </span>
              </div>
              {activeScreenFrame && (
                <span className="font-mono text-[10px] text-zinc-400">
                  {activeScreenFrame.width}×{activeScreenFrame.height}
                </span>
              )}
            </div>

            {activeScreenFrame ? (
              <div className="relative flex w-full items-center justify-center bg-black/75 p-2">
                <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-zinc-800">
                  <img
                    src={`data:${activeScreenFrame.mimeType};base64,${activeScreenFrame.imageBase64}`}
                    alt="Live Device Screen"
                    className="block max-h-[380px] w-auto max-w-full object-contain select-none"
                  />
                  {typeof activeScreenFrame.cursorX === 'number' &&
                    typeof activeScreenFrame.cursorY === 'number' && (
                      <div
                        style={{
                          left: `${Math.min(100, Math.max(0, activeScreenFrame.cursorX / 10))}%`,
                          top: `${Math.min(100, Math.max(0, activeScreenFrame.cursorY / 10))}%`,
                        }}
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                      >
                        <span className="absolute -inset-3 animate-ping rounded-full bg-rose-500/50" />
                        <span className="relative block h-3.5 w-3.5 rounded-full border-2 border-white bg-rose-500 shadow-lg" />
                      </div>
                    )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-primary">
                  <MonitorSmartphone className="h-6 w-6" />
                </div>
                <div className="max-w-xs space-y-1">
                  <div className="text-xs font-semibold text-zinc-100">
                    {activeDevice
                      ? 'Belum ada frame layar tertangkap'
                      : 'Hubungkan Desktop atau HP Android'}
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    {activeDevice
                      ? 'Kirim perintah ke chat (misal: "Lihat layar saat ini dan buka browser") agar AI mengambil screenshot pertama.'
                      : 'Pasang Companion Bridge untuk kendali penuh PC/HP nyata, atau aktifkan Simulator untuk langsung menguji AI Operator.'}
                  </p>
                </div>
                {!activeDevice ? (
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleCreatePair('desktop')}
                      className="h-8 gap-1.5 rounded-xl text-xs"
                    >
                      <Laptop className="h-3.5 w-3.5" />
                      Pair Desktop / HP
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRegisterSimulator('desktop')}
                      className="h-8 gap-1.5 rounded-xl border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      <Play className="h-3.5 w-3.5 text-emerald-400" />
                      Uji Desktop Simulator
                    </Button>
                  </div>
                ) : (
                  onSendQuickCommand && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onSendQuickCommand(
                          'Ambil screenshot layar device saat ini lalu jelaskan apa yang terlihat di layar.'
                        )
                      }
                      className="h-8 gap-1.5 rounded-xl border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      <Activity className="h-3.5 w-3.5 text-primary" />
                      Minta AI Lihat Layar
                    </Button>
                  )
                )}
              </div>
            )}
          </div>

          {/* Safety Mode Summary */}
          <div className="flex items-start gap-2.5 rounded-xl border bg-card/60 px-3 py-2.5 text-[11px]">
            {approvalMode === 'autonomous' ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            )}
            <div className="min-w-0">
              <span className="font-semibold text-foreground">
                Mode Keamanan:{' '}
                {APPROVAL_MODE_OPTIONS.find((o) => o.id === approvalMode)?.label}
              </span>
              <p className="text-muted-foreground">
                {APPROVAL_MODE_OPTIONS.find((o) => o.id === approvalMode)?.desc}. Gunakan{' '}
                <strong>Take Over</strong> kapan saja untuk mengambil alih kontrol manual.
              </p>
            </div>
          </div>

          {/* Action Timeline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Action Timeline</span>
              <span className="font-mono">{actionLogs.length} aksi</span>
            </div>
            {actionLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
                Riwayat klik, tap, ketik, dan navigasi AI akan muncul di sini secara real-time.
              </div>
            ) : (
              <div className="space-y-1.5">
                {actionLogs
                  .slice()
                  .reverse()
                  .map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start justify-between gap-2 rounded-xl border bg-card/70 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-semibold text-primary">
                            {log.toolName}
                          </span>
                          {typeof log.cursorX === 'number' && typeof log.cursorY === 'number' && (
                            <span className="rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
                              ({log.cursorX}, {log.cursorY})
                            </span>
                          )}
                        </div>
                        <p className="break-words text-[11px] text-muted-foreground">
                          {log.summary}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 text-[9px] uppercase',
                          log.status === 'done'
                            ? 'border-emerald-500/35 text-emerald-400'
                            : log.status === 'running'
                              ? 'border-sky-500/35 text-sky-400'
                              : 'border-rose-500/35 text-rose-400'
                        )}
                      >
                        {log.status}
                      </Badge>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </StudioScroll>
    </aside>
  );
});
