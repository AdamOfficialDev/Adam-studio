import { memo, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Code2,
  Loader2,
  Rocket,
  ArrowRight,
  Check,
  Lightbulb,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { EmergentClarification, EmergentPlan } from '@/types/chat';

interface EmergentPlanCardProps {
  plan: EmergentPlan;
  fileCount?: number;
  onOpenWorkspace?: () => void;
  compact?: boolean;
}

const STATUS_META: Record<
  EmergentPlan['status'],
  { label: string; badgeClass: string }
> = {
  planning: {
    label: 'Planning',
    badgeClass: 'border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-300',
  },
  building: {
    label: 'Building',
    badgeClass: 'border-primary/40 bg-primary/15 text-primary',
  },
  verifying: {
    label: 'Verifying',
    badgeClass: 'border-amber-500/35 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  ready: {
    label: 'Ready',
    badgeClass: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  error: {
    label: 'Needs Fix',
    badgeClass: 'border-destructive/40 bg-destructive/15 text-destructive',
  },
};

export const EmergentPlanCard = memo(function EmergentPlanCard({
  plan,
  fileCount = 0,
  onOpenWorkspace,
  compact = false,
}: EmergentPlanCardProps) {
  const total = plan.tasks.length;
  const completed = plan.tasks.filter((t) => t.status === 'completed').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const meta = STATUS_META[plan.status] || STATUS_META.building;

  return (
    <div className="chat-card-surface my-2 overflow-hidden rounded-2xl border border-primary/35 ring-1 ring-primary/10">
      <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-border/70 bg-gradient-to-r from-primary/[0.12] via-primary/[0.04] to-transparent px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary shadow-sm">
              <Rocket className="h-3.5 w-3.5" />
            </span>
            <span className="truncate text-xs font-semibold tracking-tight text-foreground sm:text-sm">
              {plan.title}
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
                meta.badgeClass
              )}
            >
              {meta.label}
            </span>
          </div>
          {!compact && plan.summary && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {plan.summary}
            </p>
          )}
        </div>

        {onOpenWorkspace && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenWorkspace}
            className="h-7 shrink-0 gap-1.5 rounded-xl border border-primary/35 bg-primary/15 px-3 text-[11px] font-semibold text-primary shadow-sm hover:bg-primary/25"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>{fileCount > 0 ? 'Buka IDE (' + fileCount + ')' : 'Buka IDE'}</span>
          </Button>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.stack.map((tech) => (
            <span
              key={tech}
              className="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm"
            >
              <Sparkles className="h-2.5 w-2.5 text-primary" />
              {tech}
            </span>
          ))}
          <span className="ml-auto rounded-md border border-border/70 bg-background/75 px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
            {completed}/{total} ({pct}%)
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/85 p-0.5">
          <div
            className={cn(
              'h-full rounded-full bg-gradient-to-r from-primary/80 to-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)] transition-[width] duration-300',
              plan.status === 'building' && 'chat-shimmer-track'
            )}
            style={{ width: pct + '%' }}
          />
        </div>

        {!compact && plan.tasks.length > 0 && (
          <div className="space-y-1.5 pt-0.5">
            {plan.tasks.map((task) => {
              const isRunning = task.status === 'in_progress';
              const isDone = task.status === 'completed';
              const isFailed = task.status === 'failed';
              return (
                <div
                  key={task.id}
                  className={cn(
                    'flex items-start gap-2 rounded-xl border px-2.5 py-2 text-xs transition-colors',
                    isRunning
                      ? 'border-primary/40 bg-primary/[0.08] text-foreground'
                      : isDone
                        ? 'border-emerald-500/20 bg-emerald-500/[0.04] text-foreground/90'
                        : isFailed
                          ? 'border-destructive/35 bg-destructive/[0.08] text-destructive'
                          : 'border-border/60 bg-background/45 text-muted-foreground'
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : isFailed ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 opacity-50" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium leading-snug">{task.title}</div>
                    {task.detail && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {task.detail}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

interface EmergentClarificationCardProps {
  clarification: EmergentClarification;
  isStreaming?: boolean;
  onSubmit?: (replyText: string, summaryText: string) => void;
}

export const EmergentClarificationCard = memo(function EmergentClarificationCard({
  clarification,
  isStreaming = false,
  onSubmit,
}: EmergentClarificationCardProps) {
  const [selectedMap, setSelectedMap] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const q of clarification.questions) {
      const recIds = (q.options || []).filter((o) => o.recommended).map((o) => o.id);
      if (recIds.length > 0) {
        init[q.id] = q.type === 'single' ? [recIds[0]] : recIds;
      } else {
        init[q.id] = [];
      }
    }
    return init;
  });

  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  const hasRecommendedPresets = useMemo(
    () =>
      clarification.questions.some((q) => (q.options || []).some((o) => o.recommended)),
    [clarification.questions]
  );

  const toggleOption = (qId: string, optId: string, type: 'single' | 'multiple' | 'input') => {
    if (clarification.submitted || isStreaming) return;
    setSelectedMap((prev) => {
      const curr = prev[qId] || [];
      if (type === 'single') {
        return { ...prev, [qId]: curr[0] === optId ? [] : [optId] };
      }
      const exists = curr.includes(optId);
      return {
        ...prev,
        [qId]: exists ? curr.filter((x) => x !== optId) : [...curr, optId],
      };
    });
  };

  const applyAllRecommended = () => {
    if (clarification.submitted || isStreaming) return;
    const next: Record<string, string[]> = {};
    for (const q of clarification.questions) {
      const recIds = (q.options || []).filter((o) => o.recommended).map((o) => o.id);
      if (recIds.length > 0) {
        next[q.id] = q.type === 'single' ? [recIds[0]] : recIds;
      } else if (q.options && q.options.length > 0) {
        next[q.id] = [q.options[0].id];
      } else {
        next[q.id] = [];
      }
    }
    setSelectedMap(next);
  };

  const buildPayloadAndSubmit = (useAutopilot: boolean) => {
    if (!onSubmit || clarification.submitted || isStreaming) return;
    if (useAutopilot) {
      const summary = 'Pakai seluruh rekomendasi terbaik Emergent E1';
      const reply = [
        'Gunakan seluruh rekomendasi terbaik Emergent E1 untuk pertanyaan di atas dan langsung lanjutkan ke perencanaan (Blueprint Plan) serta implementasi penuh aplikasi.',
      ].join('\n');
      onSubmit(reply, summary);
      return;
    }

    const lines: string[] = ['Berikut preferensi dan spesifikasi saya untuk brief di atas:'];
    const summaryParts: string[] = [];

    for (const q of clarification.questions) {
      const chosenIds = selectedMap[q.id] || [];
      const chosenLabels = (q.options || [])
        .filter((o) => chosenIds.includes(o.id))
        .map((o) => o.label);
      const customText = (customInputs[q.id] || '').trim();

      const combined: string[] = [...chosenLabels];
      if (customText) combined.push(customText);

      if (combined.length > 0) {
        lines.push(`- **${q.question}**: ${combined.join(', ')}`);
        summaryParts.push(combined.join(', '));
      } else {
        lines.push(`- **${q.question}**: Ikuti rekomendasi terbaik Emergent E1`);
      }
    }

    lines.push('', 'Silakan buat Blueprint Plan dan bangun implementasinya secara lengkap.');
    const summary =
      summaryParts.length > 0 ? summaryParts.slice(0, 3).join(' • ') : 'Rekomendasi Emergent E1';
    onSubmit(lines.join('\n'), summary);
  };

  const isLocked = Boolean(clarification.submitted);

  return (
    <div className="chat-card-surface my-2.5 overflow-hidden rounded-2xl border border-primary/40 ring-1 ring-primary/10">
      <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-border/70 bg-gradient-to-r from-primary/[0.13] via-primary/[0.04] to-transparent px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary shadow-sm">
              <Wand2 className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
              {clarification.title}
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
                isLocked
                  ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'border-primary/35 bg-primary/15 text-primary'
              )}
            >
              {isLocked ? 'Terkirim ✓' : 'Interactive Brief'}
            </span>
          </div>
          {clarification.subtitle && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {clarification.subtitle}
            </p>
          )}
        </div>

        {!isLocked && hasRecommendedPresets && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isStreaming}
            onClick={applyAllRecommended}
            className="h-7 shrink-0 gap-1 rounded-xl border-emerald-500/35 bg-emerald-500/10 px-2.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
          >
            <Sparkles className="h-3 w-3" />
            <span>Pilih Rekomendasi</span>
          </Button>
        )}
      </div>

      {clarification.recommendation && (
        <div className="flex items-start gap-2.5 border-b border-border/65 bg-emerald-500/[0.07] px-4 py-2.5 text-[11.5px] leading-relaxed text-emerald-900 dark:text-emerald-200/95">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              Saran Emergent E1:{' '}
            </span>
            <span>{clarification.recommendation}</span>
          </div>
        </div>
      )}

      {isLocked ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            Preferensi terkirim:{' '}
            <strong className="text-foreground">
              {clarification.submittedSummary || 'Rekomendasi Emergent E1'}
            </strong>
          </span>
        </div>
      ) : (
        <div className="space-y-4 px-4 py-3.5">
          {clarification.questions.map((q, idx) => {
            const chosen = selectedMap[q.id] || [];
            return (
              <div key={q.id} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-start gap-2 text-xs font-medium text-foreground sm:text-[13px]">
                    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-[10px] font-bold text-primary">
                      {idx + 1}
                    </span>
                    <span>{q.question}</span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {q.type === 'multiple'
                      ? 'Bisa pilih beberapa'
                      : q.type === 'input'
                        ? 'Input teks'
                        : 'Pilih satu'}
                  </span>
                </div>

                {q.options && q.options.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {q.options.map((opt) => {
                      const active = chosen.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={isStreaming}
                          onClick={() => toggleOption(q.id, opt.id, q.type)}
                          className={cn(
                            'group flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
                            active
                              ? 'border-primary/70 bg-primary/15 text-foreground shadow-sm ring-1 ring-primary/25'
                              : 'border-border/75 bg-background/65 text-muted-foreground hover:border-primary/40 hover:bg-accent/45 hover:text-foreground'
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] transition-colors',
                              q.type === 'single' ? 'rounded-full' : 'rounded-md',
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border/80 bg-background'
                            )}
                          >
                            {active && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-medium leading-snug text-foreground">
                                {opt.label}
                              </span>
                              {opt.recommended && (
                                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  Recommended
                                </span>
                              )}
                            </div>
                            {opt.description && (
                              <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                                {opt.description}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {(q.type === 'input' || q.allowCustomInput) && (
                  <input
                    type="text"
                    disabled={isStreaming}
                    value={customInputs[q.id] || ''}
                    onChange={(e) =>
                      setCustomInputs((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    placeholder={
                      q.placeholder ||
                      (q.type === 'input'
                        ? 'Ketik jawaban atau detail yang kamu inginkan...'
                        : 'Tambahkan fitur atau preferensi kustom lainnya (opsional)...')
                    }
                    className="h-8 w-full rounded-xl border border-border/70 bg-background/75 px-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isStreaming || !onSubmit}
              onClick={() => buildPayloadAndSubmit(true)}
              className="h-8 rounded-xl px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              Lewati & Pakai Rekomendasi AI
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isStreaming || !onSubmit}
              onClick={() => buildPayloadAndSubmit(false)}
              className="h-8 gap-1.5 rounded-xl px-4 text-xs"
            >
              <span>Bangun Sesuai Pilihan</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

