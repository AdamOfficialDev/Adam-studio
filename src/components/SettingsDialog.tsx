import { memo, useEffect, useState } from 'react';
import {
  Brain,
  Check,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Palette,
  Radio,
  RotateCcw,
  ShieldAlert,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
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
import { PERSONA_PRESETS } from '@/lib/personas';
import { countApiKeys, DEFAULT_SETTINGS } from '@/lib/storage';
import type { AppSettings, ServerHealth, ThemeSkin } from '@/types/chat';
import { cn } from '@/lib/utils';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  serverHealth: ServerHealth | null;
  onSave: (next: AppSettings) => void;
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

const THINKING_BUDGET_OPTIONS = [
  { label: 'Auto', value: -1 },
  { label: '1K', value: 1024 },
  { label: '4K', value: 4096 },
  { label: '8K', value: 8192 },
  { label: '16K', value: 16384 },
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
  serverHealth,
  onSave,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(settings);
    }
  }, [open, settings]);

  const handleSave = () => {
    onSave({
      ...draft,
      temperature: Math.min(2, Math.max(0, Number(draft.temperature) || 0.7)),
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
            <DialogHeader className="shrink-0 border-b bg-card/60 px-5 py-4 sm:px-6">
              <DialogTitle>Adam Studio — Settings & Appearance</DialogTitle>
              <DialogDescription>
                Auto-Rotate API Key Pool, Retry 503, Thinking Summaries, & tema visual.
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="connection" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b bg-muted/25 px-4 py-2.5 sm:px-6">
                <TabsList className="grid h-9 w-full grid-cols-3 rounded-xl">
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
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Brain className="h-4 w-4 text-primary" />
                          Tampilkan Thinking Process (AI Studio Style)
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Kirim <code>includeThoughts: true</code> agar rencana pemikiran model
                          tampil real-time saat streaming.
                        </p>
                      </div>
                      <Switch
                        checked={draft.includeThoughts && draft.thinkingBudget !== 0}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            includeThoughts: checked,
                            thinkingBudget:
                              checked && draft.thinkingBudget === 0 ? -1 : draft.thinkingBudget,
                          })
                        }
                      />
                    </div>

                    {draft.includeThoughts && draft.thinkingBudget !== 0 && (
                      <div className="space-y-1.5 border-t border-border/60 pt-3">
                        <div className="text-[11px] font-medium text-muted-foreground">
                          Thinking Token Budget
                        </div>
                        <div className="grid grid-cols-5 gap-1.5">
                          {THINKING_BUDGET_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  includeThoughts: true,
                                  thinkingBudget: opt.value,
                                })
                              }
                              className={cn(
                                'rounded-lg border py-1.5 font-mono text-[11px] transition-colors',
                                draft.thinkingBudget === opt.value
                                  ? 'border-primary bg-primary/15 font-semibold text-primary'
                                  : 'bg-background/50 hover:bg-accent'
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
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
                        return (
                          <button
                            key={persona.id}
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                activePersonaId: persona.id,
                                systemInstruction: persona.systemInstruction,
                                temperature: persona.temperature,
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
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                T {persona.temperature.toFixed(1)}
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

                  <div className="grid grid-cols-1 gap-4 rounded-2xl border bg-card/50 p-4 sm:grid-cols-2">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span>Temperature</span>
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-primary">
                          {draft.temperature.toFixed(1)}
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={2}
                        step={0.1}
                        value={[draft.temperature]}
                        onValueChange={([val]) => setDraft({ ...draft, temperature: val })}
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>Presisi (0.0)</span>
                        <span>Kreatif (2.0)</span>
                      </div>
                    </div>

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
                              'flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors',
                              active
                                ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                                : 'bg-card/60 hover:bg-accent/40'
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div
                                className={cn(
                                  'flex h-10 w-12 shrink-0 flex-col justify-between rounded-lg border p-1.5',
                                  s.bgClass,
                                  s.cardClass
                                )}
                              >
                                <div className={cn('h-1.5 w-6 rounded-full', s.accentClass)} />
                                <div className="space-y-1">
                                  <div className="h-1 w-full rounded bg-current opacity-20" />
                                  <div className="h-1 w-2/3 rounded bg-current opacity-15" />
                                </div>
                              </div>

                              <div className="min-w-0">
                                <div className="text-xs font-semibold">{s.label}</div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {s.desc}
                                </div>
                              </div>
                            </div>

                            {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
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

            <DialogFooter className="shrink-0 justify-between border-t bg-card/80 px-4 py-3 sm:px-6">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 text-xs text-muted-foreground"
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
                <Button type="button" size="sm" onClick={handleSave} className="rounded-xl px-4">
                  Simpan
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
