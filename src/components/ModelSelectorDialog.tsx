import { memo, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Cpu, DollarSign, Info, Rocket, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PRESET_MODELS, type ModelCategory } from '@/lib/models';
import { cn } from '@/lib/utils';

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
    try {
      await navigator.clipboard.writeText(id);
      toast.success(`ID "${id}" disalin`);
    } catch {
      // Abaikan
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {open && (
          <>
            <DialogHeader className="shrink-0 border-b bg-card/60 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <DialogTitle>Model Selection</DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs">
                    Aktif saat ini: <span className="font-mono text-foreground">{selectedModel}</span>
                  </DialogDescription>
                </div>
              </div>

              <div className="mt-3.5 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari model atau agent..."
                    className="h-9 rounded-xl bg-background/80 pl-9 pr-9 text-xs sm:text-sm"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {FILTER_TABS.map((tab) => {
                    const active = activeTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          'relative isolate rounded-full px-3.5 py-1 text-xs font-semibold transition-colors',
                          active
                            ? 'text-primary-foreground'
                            : 'border border-border/70 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground'
                        )}
                      >
                        {active && (
                          <motion.span
                            layoutId="model-modal-tab"
                            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                            className="absolute inset-0 z-0 rounded-full bg-primary shadow-sm"
                          />
                        )}
                        <span className="relative z-10">{tab}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4 overscroll-contain sm:p-6">
              {activeTab !== 'Custom' ? (
                <>
                  {filteredModels.map((model) => {
                    const isSelected = selectedModel === model.id;
                    return (
                      <div
                        key={model.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleChoose(model.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') handleChoose(model.id);
                        }}
                        className={cn(
                          'group cursor-pointer rounded-2xl border p-3.5 text-left transition-colors sm:p-4',
                          isSelected
                            ? 'border-primary/80 bg-primary/[0.08] ring-1 ring-primary/35 shadow-sm'
                            : 'border-border/80 bg-card/70 hover:border-primary/40 hover:bg-accent/40'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={cn(
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                                isSelected
                                  ? 'bg-primary text-primary-foreground shadow-md'
                                  : 'bg-primary/15 text-primary'
                              )}
                            >
                              <Sparkles className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate font-semibold text-foreground">
                                  {model.name}
                                </span>
                                {model.isNew && (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1 bg-emerald-500/15 px-2 py-0 text-[10px] text-emerald-500"
                                  >
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
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
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  title="Copy Model ID"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {isSelected && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary">
                              <Check className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Active</span>
                            </span>
                          )}
                        </div>

                        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-75" />
                          <span>{model.description}</span>
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-lg border bg-background/60 px-2 py-1 text-muted-foreground">
                            <DollarSign className="h-3 w-3 text-emerald-400" />
                            In ${model.inputPricePerMillion.toFixed(2)} • Out $
                            {model.outputPricePerMillion.toFixed(2)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-lg border bg-background/60 px-2 py-1 text-muted-foreground">
                            <Rocket className="h-3 w-3 text-primary" />
                            {model.releaseDate}
                          </span>
                          <span className="rounded-lg border bg-background/60 px-2 py-1 text-muted-foreground">
                            {model.contextLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {filteredModels.length === 0 && (
                    <div className="rounded-2xl border border-dashed py-10 text-center text-xs text-muted-foreground">
                      Tidak ada model yang cocok. Gunakan kolom Custom Model ID di bawah.
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed bg-card/50 p-5 text-center text-xs leading-relaxed text-muted-foreground">
                  Masukkan ID model Gemini apa saja pada kolom di bawah (misal{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                    gemini-4-hydrogen
                  </code>{' '}
                  atau preview endpoint terbaru).
                </div>
              )}
            </div>

            <div className="shrink-0 border-t bg-card/80 px-4 py-3.5 sm:px-6">
              <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                Custom Model ID
              </div>
              <div className="flex gap-2">
                <Input
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplyCustom();
                  }}
                  placeholder="Contoh: gemini-4-hydrogen"
                  className="h-9 rounded-xl font-mono text-xs"
                />
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
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
