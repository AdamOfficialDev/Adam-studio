import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Palette,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
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
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { StudioScroll } from '@/components/ui/studio-scroll';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PERSONA_PRESETS } from '@/lib/personas';
import { DEFAULT_SETTINGS } from '@/lib/storage';
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

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  serverHealth,
  onSave,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const sysTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setTimeout(() => {
        if (sysTextareaRef.current) {
          sysTextareaRef.current.style.height = 'auto';
          sysTextareaRef.current.style.height = `${sysTextareaRef.current.scrollHeight}px`;
        }
      }, 20);
    }
  }, [open, settings]);

  const syncSysTextareaHeight = () => {
    const el = sysTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

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
    setTimeout(syncSysTextareaHeight, 10);
    toast.success('Parameter di-reset ke default');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b bg-card/60 px-5 py-4 sm:px-6">
          <DialogTitle>Adam Studio — Settings & Appearance</DialogTitle>
          <DialogDescription>
            Koneksi Gemini SSE, kepribadian AI, tema visual, dan perilaku Canvas.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="connection" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b bg-muted/25 px-4 py-2.5 sm:px-6">
            <TabsList className="grid h-9 w-full grid-cols-3 rounded-xl">
              <TabsTrigger value="connection" className="gap-1.5 rounded-lg text-[11px] sm:text-xs">
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <span>Koneksi</span>
              </TabsTrigger>
              <TabsTrigger value="persona" className="gap-1.5 rounded-lg text-[11px] sm:text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                <span>Persona</span>
              </TabsTrigger>
              <TabsTrigger value="appearance" className="gap-1.5 rounded-lg text-[11px] sm:text-xs">
                <Palette className="h-3.5 w-3.5 shrink-0" />
                <span>Tema</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <StudioScroll className="min-h-0 flex-1" autoHide="scroll">
            <div className="p-4 sm:p-6">
              <TabsContent value="connection" className="mt-0 space-y-4">
                <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm font-semibold">Gemini API Key</label>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                        draft.apiKey.trim() || serverHealth?.hasServerApiKey
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-amber-500/15 text-amber-400'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          draft.apiKey.trim() || serverHealth?.hasServerApiKey
                            ? 'bg-emerald-400'
                            : 'bg-amber-400'
                        )}
                      />
                      {draft.apiKey.trim()
                        ? 'Browser Key Aktif'
                        : serverHealth?.hasServerApiKey
                          ? 'Server .env Aktif'
                          : 'Belum Ada Key'}
                    </span>
                  </div>

                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={draft.apiKey}
                      onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                      placeholder="AIza... (opsional jika sudah diset di .env)"
                      className="h-10 rounded-xl pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Toggle API key visibility"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Disimpan lokal di browser dan diteruskan via header ke proxy SSE tanpa
                    mengekspos `.env` server.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-2xl border bg-card/60 p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Radio className="h-4 w-4 text-primary" />
                      Demo SSE Mode (Showcase Lokal)
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Uji streaming SSE, Mermaid diagram, LaTeX math, & HTML Artifact tanpa API key.
                    </p>
                  </div>
                  <Switch
                    checked={draft.demoMode}
                    onCheckedChange={(checked) => setDraft({ ...draft, demoMode: checked })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="persona" className="mt-0 space-y-5">
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
                          onClick={() => {
                            setDraft({
                              ...draft,
                              activePersonaId: persona.id,
                              systemInstruction: persona.systemInstruction,
                              temperature: persona.temperature,
                            });
                            setTimeout(syncSysTextareaHeight, 10);
                          }}
                          className={cn(
                            'rounded-xl border p-3 text-left transition-all',
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
                  <div className="rounded-xl border bg-background/80 p-1 focus-within:ring-2 focus-within:ring-ring">
                    <StudioScroll className="max-h-[140px] w-full" autoHide="scroll">
                      <Textarea
                        ref={sysTextareaRef}
                        rows={3}
                        value={draft.systemInstruction}
                        onChange={(e) => {
                          setDraft({ ...draft, systemInstruction: e.target.value });
                          syncSysTextareaHeight();
                        }}
                        className="min-h-[72px] resize-none overflow-hidden border-0 bg-transparent px-2.5 py-2 text-xs leading-relaxed shadow-none focus-visible:ring-0"
                      />
                    </StudioScroll>
                  </div>
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
                            'flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-all',
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
          </StudioScroll>
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
      </DialogContent>
    </Dialog>
  );
}
