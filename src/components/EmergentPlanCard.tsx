import { memo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Code2,
  Loader2,
  Rocket,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { EmergentPlan } from '@/types/chat';

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
    badgeClass: 'border-sky-500/30 bg-sky-500/15 text-sky-400',
  },
  building: {
    label: 'Building',
    badgeClass: 'border-primary/35 bg-primary/15 text-primary',
  },
  verifying: {
    label: 'Verifying',
    badgeClass: 'border-amber-500/35 bg-amber-500/15 text-amber-400',
  },
  ready: {
    label: 'Ready',
    badgeClass: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-400',
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
    <div className="my-2 overflow-hidden rounded-2xl border border-primary/30 bg-card/85 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-border/70 bg-primary/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
              <Rocket className="h-3.5 w-3.5" />
            </span>
            <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
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
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
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
            className="h-7 shrink-0 gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 text-[11px] text-primary hover:bg-primary/20"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>{fileCount > 0 ? 'Buka IDE (' + fileCount + ')' : 'Buka IDE'}</span>
          </Button>
        )}
      </div>

      <div className="space-y-2.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.stack.map((tech) => (
            <span
              key={tech}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              <Sparkles className="h-2.5 w-2.5 text-primary" />
              {tech}
            </span>
          ))}
          <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
            {completed}/{total} ({pct}%)
          </span>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
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
