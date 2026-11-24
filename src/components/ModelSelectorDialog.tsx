import { memo, useMemo, useState } from 'react';
import { Brain, Check, Copy, Cpu, DollarSign, Info, Rocket, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  StudioModalBody,
  StudioModalFooter,
  StudioModalHeader,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PRESET_MODELS,
  THINKING_LEVEL_META,
  getModelThinkingCapabilities,
  type ModelCategory,
} from '@/lib/models';
import { cn, copyToClipboard } from '@/lib/utils';

interface ModelSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
}

const FILTER_TABS: Array<'All' | ModelCategory> = ['All', 'Featured', 'Gemini', 'Custom'];

export const ModelSelectorDialog = memo(function ModelSelectorDialog({
  open,
  onOpenChange,
  selectedModel,
  onSelectModel,
}: ModelSelectorDialogProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'All' | ModelCategory>('Featured');
  const [customModelInput, setCustomModelInput] = useState('');

  const tabCounts = useMemo(() => {
    const counts: Record<'All' | ModelCategory, number> = {
      All: PRESET_MODELS.length,
      Featured: 0,
      Gemini: 0,
      Custom: 0,
    };
    for (const m of PRESET_MODELS) {
      for (const cat of m.categories) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  }, []);

  const filteredModels = useMemo(() => {
    if (!open) return [];
    const q = search.trim().toLowerCase();
    return PRESET_MODELS.filter((m) => {
      const matchesTab = activeTab === 'All' || m.categories.includes(activeTab);
      const matchesQuery =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q);
      return matchesTab && matchesQuery;
    });
  }, [activeTab, open, search]);

  const handleChoose = (modelId: string) => {
    onSelectModel(modelId);
    onOpenChange(false);
  };

  const handleApplyCustom = () => {
    const trimmed = customModelInput.trim();
    if (!trimmed) return;
    handleChoose(trimmed);
    setCustomModelInput('');
  };

  const copyId = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const ok = await copyToClipboard(id);
    if (ok) {
      toast.success(`ID "${id}" disalin`);
    } else {
      toast.error('Gagal menyalin ID model');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open && (
          <>
            <StudioModalHeader
              icon={<Cpu className="h-[18px] w-[18px]" />}
              title="Model Selection"
              badge={
                <span className="max-w-[190px] truncate rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-medium text-primary sm:max-w-[260px]">
                  {selectedModel}
                </span>
              }
              description="Pilih engine AI terbaik untuk coding, reasoning, atau custom endpoint."
            >
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari nama model, ID, atau kemampuan..."
                    className="h-9 rounded-xl border-border/80 bg-background/80 pl-9 pr-9 text-xs sm:text-sm"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid w-full grid-cols-4 gap-1 rounded-xl border border-border/75 bg-background/60 p-1 sm:inline-flex sm:w-auto">
                  {FILTER_TABS.map((tab) => {
                    const active = activeTab === tab;
                    const count = tabCounts[tab];
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 sm:px-3.5',
                          active
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                        )}
                      >
                        <span className="truncate">{tab}</span>
                        {tab !== 'Custom' && (
                          <span
                            className={cn(
                              'hidden rounded-md px-1.5 py-0 font-mono text-[10px] xs:inline-block sm:inline-block',
                              active
                                ? 'bg-primary-foreground/20 text-primary-foreground'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </StudioModalHeader>

            <StudioModalBody className="space-y-3">
              {activeTab !== 'Custom' ? (
                <>
                  {filteredModels.map((model) => {
                    const isSelected = selectedModel === model.id;
                    const thinkingCaps = getModelThinkingCapabilities(model.id);
                    return (
                      <div
                        key={model.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleChoose(model.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleChoose(model.id);
                          }
                        }}
                        className={cn(
                          'group relative cursor-pointer overflow-hidden rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.992]',
                          isSelected
                            ? 'border-primary/80 bg-primary/[0.09] ring-1 ring-primary/35'
                            : 'border-border/80 bg-card/85 hover:border-primary/45 hover:bg-card'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={cn(
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-150',
                                isSelected
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-primary/15 text-primary group-hover:bg-primary/20'
                              )}
                            >
                              <Sparkles className="h-[18px] w-[18px]" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {model.name}
                                </span>
                                {model.isNew && (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0 text-[10px] font-semibold text-emerald-400"
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                    New
                                  </Badge>
                                )}
                              </div>

                              <div className="mt-0.5 flex items-center gap-1.5">
                                <code className="truncate font-mono text-[11px] text-muted-foreground">
                                  {model.id}
                                </code>
                                <button
                                  type="button"
                                  onClick={(e) => copyId(e, model.id)}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  title="Copy Model ID"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {isSelected && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
                              <Check className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Active</span>
                            </span>
                          )}
                        </div>

                        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-75" />
                          <span>{model.description}</span>
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-background/70 px-2 py-1 text-muted-foreground">
                            <DollarSign className="h-3 w-3 text-emerald-400" />
                            In ${model.inputPricePerMillion.toFixed(2)} • Out $
                            {model.outputPricePerMillion.toFixed(2)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-background/70 px-2 py-1 text-muted-foreground">
                            <Rocket className="h-3 w-3 text-primary" />
                            {model.releaseDate}
                          </span>
                          <span className="rounded-lg border border-border/75 bg-background/70 px-2 py-1 text-muted-foreground">
                            {model.contextLabel}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-lg border border-primary/25 bg-primary/10 px-2 py-1 font-medium text-primary">
                            <Brain className="h-3 w-3" />
                            {thinkingCaps.supported
                              ? thinkingCaps.supportedLevels
                                  .map((l) => THINKING_LEVEL_META[l].label)
                                  .join(' • ')
                              : 'No Thinking'}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {filteredModels.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-card/40 py-10 text-center text-xs text-muted-foreground">
                      Tidak ada model yang cocok. Gunakan kolom Custom Model ID di bawah.
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 bg-card/60 p-5 text-center text-xs leading-relaxed text-muted-foreground">
                  Masukkan ID model Gemini apa saja pada kolom di bawah (misal{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                    gemini-4-hydrogen
                  </code>{' '}
                  atau preview endpoint terbaru).
                </div>
              )}
            </StudioModalBody>

            <StudioModalFooter className="block space-y-2 sm:block">
              <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                <span>Custom Model ID</span>
                <span className="truncate font-mono text-[10px] text-primary">
                  {customModelInput.trim()
                    ? (() => {
                        const c = getModelThinkingCapabilities(customModelInput.trim());
                        return c.supported
                          ? `Auto Thinking: ${c.supportedLevels.map((l) => THINKING_LEVEL_META[l].label).join(' / ')}`
                          : 'Auto: Tanpa Thinking';
                      })()
                    : 'Tekan Enter untuk terapkan'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-primary">
                    &gt;_
                  </span>
                  <Input
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplyCustom();
                    }}
                    placeholder="gemini-4-hydrogen"
                    className="h-9 rounded-xl border-border/80 bg-background/85 pl-9 font-mono text-xs"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyCustom}
                  disabled={!customModelInput.trim()}
                  className="h-9 shrink-0 rounded-xl px-4"
                >
                  Pakai
                </Button>
              </div>
            </StudioModalFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
