import { memo, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Brain,
  Database,
  Download,
  Check,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Palette,
  Radio,
  RotateCcw,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import type { AppSettings, Conversation, ServerHealth, ThemeSkin } from '@/types/chat';
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

const HISTORY_LIMIT_OPTIONS = [
  { label: 'Semua', value: 0 },
  { label: '20 Pesan', value: 20 },
  { label: '10 Pesan', value: 10 },
  { label: '6 Pesan', value: 6 },
];

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

  const handleSave = () => {
    onSave({
      ...draft,
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
      <DialogContent className="flex max-h-[90dvh] max-w-xl flex-col gap-0 overflow-hidden p-0">
        {open && (
          <>
            <DialogHeader className="studio-modal-header shrink-0 border-b border-border/70 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30 shadow-sm">
                  <Settings className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle>Settings & Appearance</DialogTitle>
                    <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium capitalize text-primary">
                      {draft.skin}
                    </span>
                  </div>
                  <DialogDescription className="mt-0.5 text-xs">
                    API Key Rotation, Persona AI, Thinking Level, & Theme Skin.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <Tabs defaultValue="connection" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-2.5 sm:px-6">
                <TabsList className="grid h-10 w-full grid-cols-3 rounded-xl border border-border/60 bg-muted/50 p-1">
                  <TabsTrigger
                    value="connection"
                    className="gap-1.5 rounded-lg text-[11px] sm:text-xs"
                  >
                    <KeyRound className="h-3.5 w-3.5 shrink-0" />
                    <span>Koneksi</span>
                  </TabsTrigger>
                  <TabsTrigger value="persona" className="gap-1.5 rounded-lg text-[11px] sm:text-xs">
                    <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                    <span>Persona</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="appearance"
                    className="gap-1.5 rounded-lg text-[11px] sm:text-xs"
                  >
                    <Palette className="h-3.5 w-3.5 shrink-0" />
                    <span>Tema</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 overscroll-contain sm:p-6">
                <TabsContent value="connection" className="mt-0 space-y-4">
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

                    <div className="space-y-2 border-t border-border/60 pt-2.5">
                      <div className="flex items-center justify-between gap-2">
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={checkingKeyPool}
                          onClick={() => void fetchKeyPoolStatus(draft.apiKey)}
                          className="h-6 rounded-lg px-2 text-[10px]"
                        >
                          {checkingKeyPool ? 'Memeriksa...' : 'Refresh Status'}
                        </Button>
                      </div>
                      {keyPoolStatus.length === 0 ? (
                        <p className="text-[10px] text-amber-400/90">
                          Belum ada API Key aktif terdeteksi di Browser maupun Server Env.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                            <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
                              {keyPoolStatus.filter((k) => k.status === 'ready').length} Ready
                            </span>
                            {keyPoolStatus.some((k) => k.status === 'cooldown') && (
                              <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-400">
                                {keyPoolStatus.filter((k) => k.status === 'cooldown').length}{' '}
                                Cooldown
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
                            {keyPoolStatus.map((item) => (
                              <span
                                key={item.label}
                                className={cn(
                                  'inline-flex items-center gap-1.5 truncate rounded-lg border px-2 py-1 font-mono text-[10px]',
                                  item.status === 'cooldown'
                                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                                    : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-400'
                                )}
                              >
                                <span
                                  className={cn(
                                    'h-1.5 w-1.5 shrink-0 rounded-full',
                                    item.status === 'cooldown'
                                      ? 'animate-pulse bg-amber-400'
                                      : 'bg-emerald-400'
                                  )}
                                />
                                <span className="truncate">
                                  {item.label}
                                  {item.status === 'cooldown'
                                    ? ` (${item.cooldownRemainingSec}s)`
                                    : ' Ready'}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
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

                  <div className="space-y-2.5 rounded-2xl border bg-card/60 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <History className="h-4 w-4 text-primary" />
                      Batas Riwayat Konteks Terkirim
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Membatasi jumlah pesan lama yang dikirim ulang agar chat panjang tidak memicu
                      limit 250k TPM Free Tier.
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {HISTORY_LIMIT_OPTIONS.map((opt) => (
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
              </div>
            </Tabs>

            <DialogFooter className="studio-modal-footer shrink-0 justify-between border-t border-border/70 px-4 py-3.5 sm:px-6">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Reset Default</span>
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="rounded-xl px-4"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  className="rounded-xl px-5 shadow-sm shadow-primary/25"
                >
                  Simpan Perubahan
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
