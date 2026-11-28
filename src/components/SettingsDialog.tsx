import { memo, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Brain,
  Code2,
  Database,
  Download,
  Check,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Layers,
  Palette,
  Radio,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  StudioModalBody,
  StudioModalFooter,
  StudioModalHeader,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  DEFAULT_MODEL_ID,
  THINKING_LEVEL_META,
  getModelThinkingCapabilities,
  resolveValidThinkingLevel,
} from '@/lib/models';
import { PERSONA_PRESETS } from '@/lib/personas';
import {
  exportAllConversationsBackup,
  getIndexedDbStats,
  restoreConversationsBackup,
} from '@/lib/db';
import { countApiKeys, DEFAULT_SETTINGS } from '@/lib/storage';
import type {
  AppSettings,
  ContextMode,
  Conversation,
  DeviceApprovalMode,
  ServerHealth,
  ThemeSkin,
} from '@/types/chat';
import { cn } from '@/lib/utils';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  activeModel?: string;
  serverHealth: ServerHealth | null;
  onSave: (next: AppSettings) => void;
  onConversationsRestored?: (convs: Conversation[]) => void;
}

const THEME_SKINS: Array<{
  id: ThemeSkin;
  label: string;
  desc: string;
  bgClass: string;
  cardClass: string;
  accentClass: string;
}> = [
  {
    id: 'obsidian',
    label: 'Obsidian Pro',
    desc: 'Carbon gelap & aksen Cobalt',
    bgClass: 'bg-zinc-950',
    cardClass: 'bg-zinc-900 border-zinc-800',
    accentClass: 'bg-blue-500',
  },
  {
    id: 'claude',
    label: 'Claude Dusk',
    desc: 'Charcoal hangat & Terracotta',
    bgClass: 'bg-stone-950',
    cardClass: 'bg-stone-900 border-stone-800',
    accentClass: 'bg-orange-400',
  },
  {
    id: 'aurora',
    label: 'Cyber Aurora',
    desc: 'Midnight indigo & Cyan',
    bgClass: 'bg-slate-950',
    cardClass: 'bg-slate-900 border-slate-800',
    accentClass: 'bg-cyan-400',
  },
  {
    id: 'paper',
    label: 'Paper Editorial',
    desc: 'Krem terang nyaman dibaca',
    bgClass: 'bg-stone-100',
    cardClass: 'bg-white border-stone-200',
    accentClass: 'bg-blue-600',
  },
];

const CONTEXT_MODES: Array<{
  id: ContextMode;
  label: string;
  badge: string;
  desc: string;
}> = [
  {
    id: 'smart-rolling',
    label: 'Smart Rolling Memory',
    badge: 'Ribuan Chat',
    desc: 'Semua chat disimpan utuh di IndexedDB. Pesan lama otomatis diringkas ke Memori Inti & hanya N chat terbaru yang dikirim.',
  },
  {
    id: 'sliding-window',
    label: 'Strict Sliding Window',
    badge: 'Super Hemat',
    desc: 'Hanya mengirim N chat paling baru saja ke API tanpa summary lama (cocok untuk hemat token maksimal).',
  },
  {
    id: 'full',
    label: 'Full History',
    badge: 'Standar',
    desc: 'Mengirim seluruh riwayat chat dari awal sesi (atau dibatasi manual di bawah).',
  },
];

const RECENT_MSG_PRESETS = [4, 10, 15, 25, 50];
const BATCH_SIZE_PRESETS = [4, 6, 10, 20];
const CODE_BLOCK_PRESETS = [0, 1, 2, 3, 5];

export const SettingsDialog = memo(function SettingsDialog({
  open,
  onOpenChange,
  settings,
  activeModel,
  serverHealth,
  onSave,
  onConversationsRestored,
}: SettingsDialogProps) {
  const effectiveModel = activeModel || DEFAULT_MODEL_ID;
  const thinkingCaps = getModelThinkingCapabilities(effectiveModel);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [idbStats, setIdbStats] = useState<{ count: number; usedLabel: string } | null>(null);
  const [keyPoolStatus, setKeyPoolStatus] = useState<
    Array<{ label: string; status: 'ready' | 'cooldown'; cooldownRemainingSec: number }>
  >([]);
  const [keyPoolSource, setKeyPoolSource] = useState<'browser' | 'server' | 'none'>('none');
  const [keyPoolStore, setKeyPoolStore] = useState<'upstash-redis' | 'memory'>('memory');
  const [checkingKeyPool, setCheckingKeyPool] = useState(false);
  const [showDaytonaKey, setShowDaytonaKey] = useState(false);
  const [testingDaytona, setTestingDaytona] = useState(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const latestApiKeyRef = useRef(draft.apiKey);
  latestApiKeyRef.current = draft.apiKey;

  const fetchKeyPoolStatus = async (rawKeys: string, silent = false) => {
    if (!silent) setCheckingKeyPool(true);
    try {
      const normalized = rawKeys
        .split(/[\r\n,;]+/)
        .map((k) => k.trim())
        .filter(Boolean)
        .join(',');
      const res = await fetch('/api/key-status', {
        method: 'POST',
        headers: normalized ? { 'x-gemini-api-keys': normalized } : {},
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.keys)) {
          setKeyPoolStatus(json.keys);
        }
        if (json?.source === 'browser' || json?.source === 'server' || json?.source === 'none') {
          setKeyPoolSource(json.source);
        }
        if (json?.sharedStore === 'upstash-redis' || json?.sharedStore === 'memory') {
          setKeyPoolStore(json.sharedStore);
        }
      }
    } catch {
      if (!silent) toast.error('Gagal memeriksa status cooldown key');
    } finally {
      if (!silent) setCheckingKeyPool(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    void getIndexedDbStats().then(setIdbStats);
    void fetchKeyPoolStatus(settings.apiKey);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const tickId = window.setInterval(() => {
      setKeyPoolStatus((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          if (item.status !== 'cooldown' || item.cooldownRemainingSec <= 0) return item;
          changed = true;
          const remaining = item.cooldownRemainingSec - 1;
          return remaining > 0
            ? { ...item, cooldownRemainingSec: remaining }
            : { ...item, status: 'ready' as const, cooldownRemainingSec: 0 };
        });
        return changed ? next : prev;
      });
    }, 1000);

    const pollId = window.setInterval(() => {
      void fetchKeyPoolStatus(latestApiKeyRef.current, true);
    }, 10_000);

    return () => {
      window.clearInterval(tickId);
      window.clearInterval(pollId);
    };
  }, [open]);

  const handleExportBackup = async () => {
    try {
      const jsonStr = await exportAllConversationsBackup();
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `adam-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup seluruh workspace berhasil diunduh!');
    } catch {
      toast.error('Gagal membuat backup');
    }
  };

  const handleRestoreFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const merged = await restoreConversationsBackup(text);
      onConversationsRestored?.(merged);
      void getIndexedDbStats().then(setIdbStats);
      toast.success(`Berhasil restore ${merged.length} sesi percakapan!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal restore backup');
    }
  };

  const handleTestDaytona = async () => {
    setTestingDaytona(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (draft.daytonaApiKey?.trim()) headers['x-daytona-api-key'] = draft.daytonaApiKey.trim();
      if (draft.daytonaApiUrl?.trim()) headers['x-daytona-api-url'] = draft.daytonaApiUrl.trim();
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'status' }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`Daytona Terhubung (${data.sandboxCount ?? 0} sandbox)`);
      } else {
        toast.error(data.message || 'Gagal terhubung ke Daytona');
      }
    } catch {
      toast.error('Gagal menghubungi endpoint /api/sandbox');
    } finally {
      setTestingDaytona(false);
    }
  };

  const handleSave = () => {
    onSave({
      ...draft,
      contextRecentMessages: Math.max(1, Math.min(500, Number(draft.contextRecentMessages) || 15)),
      contextCompactBatchSize: Math.max(2, Math.min(100, Number(draft.contextCompactBatchSize) || 6)),
      contextKeepCodeBlocks: Math.max(0, Math.min(20, Number(draft.contextKeepCodeBlocks ?? 2))),
      maxHistoryMessages: Math.max(0, Math.min(1000, Number(draft.maxHistoryMessages) || 0)),
      thinkingLevel: resolveValidThinkingLevel(effectiveModel, draft.thinkingLevel),
      maxOutputTokens: Math.min(65536, Math.max(128, Number(draft.maxOutputTokens) || 8192)),
    });
    toast.success('Pengaturan Adam Studio disimpan');
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft({
      ...DEFAULT_SETTINGS,
      apiKey: draft.apiKey,
    });
    toast.success('Parameter di-reset ke default');
  };

  const browserKeyCount = countApiKeys(draft.apiKey);
  const serverKeyCount = serverHealth?.serverKeyCount ?? (serverHealth?.hasServerApiKey ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {open && (
          <>
            <StudioModalHeader
              icon={<Settings className="h-[18px] w-[18px]" />}
              title="Settings & Appearance"
              badge={
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-medium capitalize text-primary">
                  {draft.skin}
                </span>
              }
              description="API Key Rotation, Persona AI, Thinking Level, & Theme Skin."
            />

            <Tabs defaultValue="connection" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-border/75 bg-card/85 px-4 py-2.5 sm:px-5">
                <TabsList className="grid h-10 w-full grid-cols-4 rounded-xl border border-border/75 bg-background/60 p-1">
                  <TabsTrigger
                    value="connection"
                    className="gap-1 rounded-lg px-1.5 text-[11px] sm:gap-1.5 sm:text-xs"
                  >
                    <KeyRound className="h-3.5 w-3.5 shrink-0" />
                    <span>Koneksi</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="memory"
                    className="gap-1 rounded-lg px-1.5 text-[11px] sm:gap-1.5 sm:text-xs"
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0" />
                    <span>Memori</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="persona"
                    className="gap-1 rounded-lg px-1.5 text-[11px] sm:gap-1.5 sm:text-xs"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                    <span>Persona</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="appearance"
                    className="gap-1 rounded-lg px-1.5 text-[11px] sm:gap-1.5 sm:text-xs"
                  >
                    <Palette className="h-3.5 w-3.5 shrink-0" />
                    <span>Tema</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <StudioModalBody>
                <TabsContent value="connection" className="mt-0 space-y-4">
                      <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-foreground">
                        Device Control Safety Gate (Desktop & Android)
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Mengatur kapan AI meminta izin sebelum mengeksekusi klik, ketik, atau perintah pada perangkat.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'high-risk', label: 'High-Risk Ask' },
                          { id: 'always', label: 'Always Ask' },
                          { id: 'autonomous', label: 'Autonomous' },
                        ] as Array<{ id: DeviceApprovalMode; label: string }>
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setDraft({ ...draft, deviceApprovalMode: opt.id })}
                          className={cn(
                            'rounded-xl border py-2 text-[11px] font-medium transition-colors',
                            (draft.deviceApprovalMode || 'high-risk') === opt.id
                              ? 'border-primary bg-primary/15 font-semibold text-primary'
                              : 'bg-background/60 hover:bg-accent'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

              <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Shuffle className="h-4 w-4 text-primary" />
                        <label className="text-sm font-semibold">
                          Gemini API Key Pool (Auto-Rotation)
                        </label>
                      </div>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                          browserKeyCount > 0 || serverKeyCount > 0
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-amber-500/15 text-amber-400'
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            browserKeyCount > 0 || serverKeyCount > 0
                              ? 'bg-emerald-400'
                              : 'bg-amber-400'
                          )}
                        />
                        {browserKeyCount > 0
                          ? `${browserKeyCount} Browser Key`
                          : serverKeyCount > 0
                            ? `Server .env (${serverKeyCount} Key)`
                            : 'Belum Ada Key'}
                      </span>
                    </div>

                    <div className="relative">
                      {showKey ? (
                        <Textarea
                          rows={4}
                          value={draft.apiKey}
                          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                          placeholder={'AIzaKeyProject1...\nAIzaKeyProject2...\nAIzaKeyProject3...'}
                          className="max-h-36 rounded-xl bg-background/80 pr-10 font-mono text-xs"
                        />
                      ) : (
                        <div className="flex h-11 items-center rounded-xl border bg-background/80 px-3 pr-10 font-mono text-xs text-muted-foreground">
                          {browserKeyCount > 0
                            ? `${browserKeyCount} API key tersimpan tersembunyi (klik ikon mata untuk edit)`
                            : 'Paste 1 atau banyak API Key (1 per baris atau pisah koma)...'}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setShowKey((prev) => !prev)}
                        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Toggle API key visibility"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Masukkan banyak key (1 per baris atau pisah koma). Backend merotasi key secara{' '}
                      <strong>Round-Robin</strong> dan langsung pindah saat limit <code>429</code> /{' '}
                      <code>503</code>.
                    </p>

                    <div className="space-y-2.5 border-t border-border/60 pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Status Key Pool (
                            {keyPoolSource === 'browser'
                              ? 'Browser Keys'
                              : keyPoolSource === 'server'
                                ? 'Server Env'
                                : 'Belum ada key'}
                            )
                          </span>
                          <span className="rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                            {keyPoolStore === 'upstash-redis' ? 'Global Redis' : 'Memory Lokal'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {keyPoolStatus.length > 0 && (
                            <div className="flex items-center gap-1 font-mono text-[10px]">
                              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-400">
                                {keyPoolStatus.filter((k) => k.status === 'ready').length} Ready
                              </span>
                              {keyPoolStatus.some((k) => k.status === 'cooldown') && (
                                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-400">
                                  {keyPoolStatus.filter((k) => k.status === 'cooldown').length}{' '}
                                  Cooldown
                                </span>
                              )}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={checkingKeyPool}
                            onClick={() => void fetchKeyPoolStatus(draft.apiKey)}
                            className="h-7 rounded-lg px-2.5 text-[10px]"
                          >
                            {checkingKeyPool ? 'Memeriksa...' : 'Refresh Status'}
                          </Button>
                        </div>
                      </div>

                      {keyPoolStatus.length === 0 ? (
                        <p className="text-[11px] text-amber-400/90">
                          Belum ada API Key aktif terdeteksi di Browser maupun Server Env.
                        </p>
                      ) : (
                        <div
                          className={cn(
                            'grid grid-cols-2 gap-2 sm:grid-cols-3',
                            keyPoolStatus.length > 6 &&
                              'max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-background/50 p-2'
                          )}
                        >
                          {keyPoolStatus.map((item) => {
                            const isCooldown = item.status === 'cooldown';
                            const match = item.label.match(/^(Key #\d+)\s*\((.+)\)$/);
                            const keyName = match ? match[1] : item.label;
                            const keySuffix = match ? match[2] : '';

                            return (
                              <div
                                key={item.label}
                                className={cn(
                                  'flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 font-mono text-[11px] transition-colors',
                                  isCooldown
                                    ? 'border-amber-500/40 bg-amber-500/[0.08] text-amber-400'
                                    : 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-400'
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={cn(
                                      'h-1.5 w-1.5 shrink-0 rounded-full',
                                      isCooldown
                                        ? 'animate-pulse bg-amber-400'
                                        : 'bg-emerald-400'
                                    )}
                                  />
                                  <div className="min-w-0 leading-tight">
                                    <div className="truncate font-semibold text-foreground/90">
                                      {keyName}
                                    </div>
                                    {keySuffix && (
                                      <div className="truncate text-[10px] text-muted-foreground">
                                        {keySuffix}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <span
                                  className={cn(
                                    'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                                    isCooldown
                                      ? 'bg-amber-500/15 text-amber-400'
                                      : 'bg-emerald-500/15 text-emerald-400'
                                  )}
                                >
                                  {isCooldown ? `${item.cooldownRemainingSec}s` : 'Ready'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div><div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <ShieldAlert className="h-4 w-4 text-amber-400" />
                          Auto-Fallback saat 503 High Demand
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Jika seluruh key untuk model utama tetap penuh, otomatis pindah ke model
                          cadangan.
                        </p>
                      </div>
                      <Switch
                        checked={draft.autoFallbackOnOverload}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, autoFallbackOnOverload: checked })
                        }
                      />
                    </div>

                    {draft.autoFallbackOnOverload && (
                      <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
                        {['gemini-3.8-flash', 'gemini-4-hydrogen'].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setDraft({ ...draft, fallbackModel: m })}
                            className={cn(
                              'rounded-xl border px-3 py-2 text-left font-mono text-xs transition-colors',
                              draft.fallbackModel === m
                                ? 'border-primary bg-primary/15 font-semibold text-primary'
                                : 'bg-background/60 hover:bg-accent'
                            )}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card/60 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Radio className="h-4 w-4 text-primary" />
                        Demo SSE Mode (Showcase Lokal)
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Uji streaming Thinking, Visual Inspector, & Time-Machine Diff tanpa API key.
                      </p>
                    </div>
                    <Switch
                      checked={draft.demoMode}
                      onCheckedChange={(checked) => setDraft({ ...draft, demoMode: checked })}
                    />
                  </div>
              <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-foreground">
                      Daytona Cloud Sandbox (Real npm & Vite)
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Opsional: jalankan <code className="font-mono">npm install</code> & dev server nyata di cloud VM.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={testingDaytona}
                    onClick={() => void handleTestDaytona()}
                    className="h-7 rounded-lg px-2.5 text-[10px]"
                  >
                    {testingDaytona ? 'Menguji...' : 'Tes Koneksi'}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type={showDaytonaKey ? 'text' : 'password'}
                      value={draft.daytonaApiKey || ''}
                      onChange={(e) => setDraft({ ...draft, daytonaApiKey: e.target.value })}
                      placeholder="dtn_... (atau set DAYTONA_API_KEY di Vercel Env)"
                      className="h-9 rounded-xl pr-16 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDaytonaKey((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {showDaytonaKey ? 'Sembunyi' : 'Lihat'}
                    </button>
                  </div>
                  <Input
                    type="url"
                    value={draft.daytonaApiUrl || ''}
                    onChange={(e) => setDraft({ ...draft, daytonaApiUrl: e.target.value })}
                    placeholder="https://app.daytona.io/api"
                    className="h-8 rounded-xl font-mono text-[11px]"
                  />
                </div>
              </div>

                </TabsContent>

                <TabsContent value="memory" className="mt-0 space-y-4">
                  {/* Mode Pengiriman Konteks */}
                  <div className="space-y-2.5 rounded-2xl border bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Layers className="h-4 w-4 text-primary" />
                        Mode Konteks & Penghemat Token
                      </div>
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
                        {draft.contextMode}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Semua riwayat chat tetap tersimpan 100% utuh di IndexedDB browser untuk dibaca kapan saja. Pengaturan ini menentukan apa yang dikirim ke API tiap giliran chat.
                    </p>
                    <div className="space-y-2 pt-1">
                      {CONTEXT_MODES.map((m) => {
                        const active = draft.contextMode === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setDraft({ ...draft, contextMode: m.id })}
                            className={cn(
                              'w-full rounded-xl border p-3 text-left transition-all',
                              active
                                ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                                : 'bg-background/60 hover:bg-accent/50'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-foreground">{m.label}</span>
                              <span
                                className={cn(
                                  'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium',
                                  active
                                    ? 'bg-primary/20 text-primary'
                                    : 'bg-muted text-muted-foreground'
                                )}
                              >
                                {m.badge}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                              {m.desc}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Jumlah Chat Terbaru yang Selalu Dikirim */}
                  {draft.contextMode !== 'full' ? (
                    <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <History className="h-4 w-4 text-primary" />
                            Jumlah Chat Terbaru yang Dikirim (Window)
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Isi angka bebas (1–500). Hanya sejumlah pesan paling akhir ini yang dikirim mentah ke AI.
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            min={1}
                            max={500}
                            value={draft.contextRecentMessages}
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10);
                              setDraft({
                                ...draft,
                                contextRecentMessages: Number.isFinite(raw) ? Math.max(1, Math.min(500, raw)) : 1,
                              });
                            }}
                            className="h-8 w-20 rounded-xl bg-background/80 text-center font-mono text-xs font-bold"
                          />
                          <span className="text-[11px] text-muted-foreground">pesan</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {RECENT_MSG_PRESETS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setDraft({ ...draft, contextRecentMessages: n })}
                            className={cn(
                              'rounded-lg border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
                              draft.contextRecentMessages === n
                                ? 'border-primary bg-primary/15 font-semibold text-primary'
                                : 'bg-background/50 hover:bg-accent'
                            )}
                          >
                            {n} chat
                          </button>
                        ))}
                      </div>

                      <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-[11px] text-muted-foreground">
                        Saat ini diset ke <strong className="text-foreground">{draft.contextRecentMessages} pesan terbaru</strong>. Pesan sebelum itu tidak dikirim mentah sehingga token tetap stabil meski sesi mencapai ribuan chat.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <History className="h-4 w-4 text-primary" />
                            Batas Maksimal Pesan (Full Mode)
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Isi <code>0</code> untuk mengirim semua pesan, atau masukkan angka batas manual.
                          </p>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          max={1000}
                          value={draft.maxHistoryMessages}
                          onChange={(e) => {
                            const raw = parseInt(e.target.value, 10);
                            setDraft({
                              ...draft,
                              maxHistoryMessages: Number.isFinite(raw) ? Math.max(0, Math.min(1000, raw)) : 0,
                            });
                          }}
                          className="h-8 w-20 rounded-xl bg-background/80 text-center font-mono text-xs font-bold"
                        />
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { label: 'Semua', value: 0 },
                          { label: '30 Pesan', value: 30 },
                          { label: '15 Pesan', value: 15 },
                          { label: '10 Pesan', value: 10 },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setDraft({ ...draft, maxHistoryMessages: opt.value })}
                            className={cn(
                              'rounded-lg border py-1.5 text-[11px] font-medium transition-colors',
                              draft.maxHistoryMessages === opt.value
                                ? 'border-primary bg-primary/15 text-primary'
                                : 'bg-background/50 hover:bg-accent'
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pengaturan Lanjutan Smart Rolling & Anti-Amnesia */}
                  {draft.contextMode === 'smart-rolling' && (
                    <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <Brain className="h-3.5 w-3.5 text-primary" />
                            Auto-Summarize Rolling Memory
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Otomatis meringkas pesan lama yang keluar dari window di background lalu menggabungkannya ke Memori Inti.
                          </p>
                        </div>
                        <Switch
                          checked={draft.contextAutoSummarize}
                          onCheckedChange={(checked) =>
                            setDraft({ ...draft, contextAutoSummarize: checked })
                          }
                        />
                      </div>

                      {draft.contextAutoSummarize && (
                        <div className="space-y-2 border-t border-border/60 pt-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                Batch Arsip Otomatis (Pesan Keluar Window)
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Setiap berapa pesan di luar window sebelum dirangkum ke Rolling Memory.
                              </p>
                            </div>
                            <Input
                              type="number"
                              min={2}
                              max={100}
                              value={draft.contextCompactBatchSize}
                              onChange={(e) => {
                                const raw = parseInt(e.target.value, 10);
                                setDraft({
                                  ...draft,
                                  contextCompactBatchSize: Number.isFinite(raw)
                                    ? Math.max(2, Math.min(100, raw))
                                    : 6,
                                });
                              }}
                              className="h-8 w-20 rounded-xl bg-background/80 text-center font-mono text-xs font-bold"
                            />
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {BATCH_SIZE_PRESETS.map((b) => (
                              <button
                                key={b}
                                type="button"
                                onClick={() => setDraft({ ...draft, contextCompactBatchSize: b })}
                                className={cn(
                                  'rounded-lg border px-2.5 py-1 font-mono text-[11px]',
                                  draft.contextCompactBatchSize === b
                                    ? 'border-primary bg-primary/15 font-semibold text-primary'
                                    : 'bg-background/50 hover:bg-accent'
                                )}
                              >
                                Tiap {b} pesan
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Smart Recall & Code Deduplication */}
                  <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                    {draft.contextMode !== 'full' && (
                      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <Search className="h-3.5 w-3.5 text-primary" />
                            Smart Keyword Recall (Anti-Amnesia)
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Jika prompt terbaru menyebut nama file/topik dari chat lama di luar window, otomatis tarik hingga 3 potongan relevan dari arsip lokal.
                          </p>
                        </div>
                        <Switch
                          checked={draft.contextSmartRecall}
                          onCheckedChange={(checked) =>
                            setDraft({ ...draft, contextSmartRecall: checked })
                          }
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <Code2 className="h-3.5 w-3.5 text-primary" />
                          Deduplikasi Blok Kode Lama
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Ringkas blok kode panjang (&gt;25 baris) di pesan lama agar tidak mengirim ulang kode usang berkali-kali.
                        </p>
                      </div>
                      <Switch
                        checked={draft.contextDedupeOldCode}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, contextDedupeOldCode: checked })
                        }
                      />
                    </div>

                    {draft.contextDedupeOldCode && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                        <span className="text-[11px] text-muted-foreground">
                          Pertahankan blok kode besar terbaru secara utuh:
                        </span>
                        <div className="flex items-center gap-1.5">
                          {CODE_BLOCK_PRESETS.map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => setDraft({ ...draft, contextKeepCodeBlocks: k })}
                              className={cn(
                                'rounded-lg border px-2 py-1 font-mono text-[11px]',
                                draft.contextKeepCodeBlocks === k
                                  ? 'border-primary bg-primary/15 font-semibold text-primary'
                                  : 'bg-background/50 hover:bg-accent'
                              )}
                            >
                              {k}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* IndexedDB Storage & Backup */}
                  <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Database className="h-4 w-4 text-primary" />
                        <span>IndexedDB Storage & Backup</span>
                      </div>
                      {idbStats && (
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] text-emerald-400">
                          {idbStats.count} Sesi • {idbStats.usedLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Seluruh histori chat disimpan lokal di IndexedDB (kapasitas ratusan MB+). Export backup jika ingin memindahkan riwayat ke perangkat lain.
                    </p>
                    <input
                      ref={backupInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => void handleRestoreFile(e)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleExportBackup()}
                        className="h-8 gap-1.5 rounded-xl text-xs"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export Backup (.json)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => backupInputRef.current?.click()}
                        className="h-8 gap-1.5 rounded-xl text-xs"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Restore Backup
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="persona" className="mt-0 space-y-5">
                  <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          <Brain className="h-4 w-4 text-primary" />
                          <span>Thinking Level</span>
                          <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium text-primary">
                            {effectiveModel}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {thinkingCaps.note}
                        </p>
                      </div>
                      <Switch
                        checked={
                          thinkingCaps.supported &&
                          draft.includeThoughts &&
                          resolveValidThinkingLevel(effectiveModel, draft.thinkingLevel) !== 'off'
                        }
                        disabled={!thinkingCaps.supported}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            includeThoughts: checked,
                            thinkingLevel: checked
                              ? resolveValidThinkingLevel(effectiveModel, draft.thinkingLevel) === 'off'
                                ? thinkingCaps.defaultLevel
                                : resolveValidThinkingLevel(effectiveModel, draft.thinkingLevel)
                              : thinkingCaps.canDisable
                                ? 'off'
                                : thinkingCaps.defaultLevel,
                          })
                        }
                      />
                    </div>

                    {thinkingCaps.supported && (
                      <div className="space-y-2 border-t border-border/60 pt-3">
                        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                          <span>Level Reasoning Otomatis untuk Model Ini</span>
                          <span className="font-mono text-primary">
                            {THINKING_LEVEL_META[resolveValidThinkingLevel(effectiveModel, draft.thinkingLevel)].label}
                          </span>
                        </div>
                        <div
                          className="grid gap-1.5"
                          style={{
                            gridTemplateColumns: `repeat(${thinkingCaps.supportedLevels.length}, minmax(0, 1fr))`,
                          }}
                        >
                          {thinkingCaps.supportedLevels.map((lvl) => {
                            const activeLvl =
                              resolveValidThinkingLevel(effectiveModel, draft.thinkingLevel) === lvl;
                            return (
                              <button
                                key={lvl}
                                type="button"
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    includeThoughts: lvl !== 'off',
                                    thinkingLevel: lvl,
                                  })
                                }
                                title={THINKING_LEVEL_META[lvl].shortDesc}
                                className={cn(
                                  'rounded-lg border py-1.5 text-[11px] font-medium transition-colors',
                                  activeLvl
                                    ? 'border-primary bg-primary/15 font-semibold text-primary'
                                    : 'bg-background/50 hover:bg-accent'
                                )}
                              >
                                {THINKING_LEVEL_META[lvl].label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {THINKING_LEVEL_META[resolveValidThinkingLevel(effectiveModel, draft.thinkingLevel)].shortDesc}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Preset Persona
                    </label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {PERSONA_PRESETS.map((persona) => {
                        const active = draft.activePersonaId === persona.id;
                        const recLevel = resolveValidThinkingLevel(
                          effectiveModel,
                          persona.recommendedThinkingLevel
                        );
                        return (
                          <button
                            key={persona.id}
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                activePersonaId: persona.id,
                                systemInstruction: persona.systemInstruction,
                                thinkingLevel: recLevel,
                                includeThoughts: recLevel !== 'off',
                              })
                            }
                            className={cn(
                              'rounded-xl border p-3 text-left transition-colors',
                              active
                                ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                                : 'bg-card/70 hover:bg-accent/50'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold">{persona.name}</span>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                                {THINKING_LEVEL_META[recLevel].label}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                              {persona.tagline}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      System Instruction
                    </label>
                    <Textarea
                      rows={4}
                      value={draft.systemInstruction}
                      onChange={(e) => setDraft({ ...draft, systemInstruction: e.target.value })}
                      className="max-h-40 rounded-xl bg-background/80 text-xs leading-relaxed"
                    />
                  </div>

                  <div className="space-y-3 rounded-2xl border bg-card/50 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold">Google Search Grounding</div>
                        <p className="text-[11px] text-muted-foreground">
                          Izinkan model mencari fakta terbaru di Google beserta sitasi sumber.
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(draft.enableGoogleSearch)}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, enableGoogleSearch: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
                      <div>
                        <div className="text-xs font-semibold">URL Context</div>
                        <p className="text-[11px] text-muted-foreground">
                          Izinkan model membaca langsung isi halaman web/dokumentasi dari URL di prompt.
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(draft.enableUrlContext)}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, enableUrlContext: checked })
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-card/50 p-4">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span>Max Output Tokens</span>
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-primary">
                          {draft.maxOutputTokens.toLocaleString()}
                        </span>
                      </div>
                      <Slider
                        min={512}
                        max={32768}
                        step={512}
                        value={[draft.maxOutputTokens]}
                        onValueChange={([val]) => setDraft({ ...draft, maxOutputTokens: val })}
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>512</span>
                        <span>32,768</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="appearance" className="mt-0 space-y-4">
                  <div className="space-y-2.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Pilih Theme Skin
                    </label>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {THEME_SKINS.map((s) => {
                        const active = draft.skin === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setDraft({ ...draft, skin: s.id })}
                            className={cn(
                              'group relative flex flex-col gap-2.5 rounded-2xl border p-3 text-left transition-all duration-150',
                              active
                                ? 'border-primary bg-primary/[0.09] ring-1 ring-primary/35 shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.35)]'
                                : 'border-border/75 bg-card/60 hover:-translate-y-[1px] hover:border-primary/40 hover:bg-accent/40'
                            )}
                          >
                            {/* Mini App Preview Mockup */}
                            <div
                              className={cn(
                                'relative flex h-16 w-full overflow-hidden rounded-xl border p-1.5',
                                s.bgClass,
                                s.cardClass
                              )}
                            >
                              <div className="flex w-7 shrink-0 flex-col gap-1 border-r border-current/10 pr-1.5">
                                <div className="flex gap-0.5">
                                  <span className="h-1 w-1 rounded-full bg-current opacity-30" />
                                  <span className="h-1 w-1 rounded-full bg-current opacity-20" />
                                </div>
                                <div className={cn('h-1.5 w-full rounded-sm', s.accentClass)} />
                                <div className="h-1 w-4/5 rounded-sm bg-current opacity-15" />
                                <div className="h-1 w-3/5 rounded-sm bg-current opacity-10" />
                              </div>
                              <div className="flex flex-1 flex-col justify-between pl-2">
                                <div className="ml-auto h-2 w-10 rounded-full bg-current opacity-15" />
                                <div className="space-y-1">
                                  <div className={cn('h-1.5 w-8 rounded-full opacity-90', s.accentClass)} />
                                  <div className="h-1 w-full rounded-full bg-current opacity-15" />
                                  <div className="h-1 w-3/4 rounded-full bg-current opacity-10" />
                                </div>
                              </div>
                              {active && (
                                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                                  <Check className="h-3 w-3" />
                                </span>
                              )}
                            </div>

                            <div className="min-w-0 px-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold">{s.label}</span>
                                {active && (
                                  <span className="font-mono text-[10px] font-semibold text-primary">
                                    Aktif
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {s.desc}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card/60 p-3.5">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <Volume2 className="h-3.5 w-3.5 text-primary" />
                          Chime Notifikasi Selesai
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Bunyi harmonik lembut saat respons panjang (&gt;2.5 detik) selesai.
                        </p>
                      </div>
                      <Switch
                        checked={draft.soundChime}
                        onCheckedChange={(checked) => setDraft({ ...draft, soundChime: checked })}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card/60 p-3.5">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          Auto-Open HTML/SVG Artifacts
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Otomatis buka Canvas di panel kanan saat HTML/SVG selesai di-stream.
                        </p>
                      </div>
                      <Switch
                        checked={draft.autoOpenArtifacts}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, autoOpenArtifacts: checked })
                        }
                      />
                    </div>

                  <div className="space-y-3 rounded-2xl border bg-card/60 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Database className="h-4 w-4 text-primary" />
                        <span>IndexedDB Storage & Backup</span>
                      </div>
                      {idbStats && (
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] text-emerald-400">
                          {idbStats.count} Sesi • {idbStats.usedLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Data tersimpan lokal di IndexedDB (kapasitas ratusan MB+). Export backup jika
                      ingin memindahkan riwayat ke perangkat lain.
                    </p>
                    <input
                      ref={backupInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => void handleRestoreFile(e)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleExportBackup()}
                        className="h-8 gap-1.5 rounded-xl text-xs"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export Backup (.json)
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => backupInputRef.current?.click()}
                        className="h-8 gap-1.5 rounded-xl text-xs"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Restore Backup
                      </Button>
                    </div>
                  </div>

                    <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card/60 p-3.5">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">Compact Reading Density</div>
                        <p className="text-xs text-muted-foreground">
                          Jarak antar pesan lebih rapat untuk chat coding panjang.
                        </p>
                      </div>
                      <Switch
                        checked={draft.density === 'compact'}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, density: checked ? 'compact' : 'comfortable' })
                        }
                      />
                    </div>
                  </div>
                </TabsContent>
              </StudioModalBody>
            </Tabs>

            <StudioModalFooter className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-9 w-full justify-center gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground sm:w-auto sm:justify-start"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Default</span>
              </Button>
              <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="h-9 flex-1 rounded-xl px-4 sm:flex-initial"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  className="h-9 flex-[2] rounded-xl px-5 sm:flex-initial"
                >
                  Simpan Perubahan
                </Button>
              </div>
            </StudioModalFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
