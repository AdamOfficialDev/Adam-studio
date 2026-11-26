import { memo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Loader2,
  Terminal,
} from 'lucide-react';
import type { ToolTraceItem } from '@/types/chat';
import { cn } from '@/lib/utils';

interface ToolTraceCardProps {
  events?: ToolTraceItem[];
  isStreaming?: boolean;
}

export const ToolTraceCard = memo(function ToolTraceCard({
  events = [],
  isStreaming = false,
}: ToolTraceCardProps) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  if (events.length === 0) return null;

  const hasRunning = events.some((e) => e.status === 'running');
  const doneCount = events.filter((e) => e.status === 'done').length;
  const errorCount = events.filter((e) => e.status === 'error').length;
  const hasEmergentTool = events.some(
    (e) => e.name.startsWith('emergent_') || e.name.startsWith('workspace_')
  );
  const isOpen = manualOpen ?? (isStreaming && hasRunning);

  return (
    <div
      className={cn(
        'chat-card-surface w-full min-w-0 max-w-full overflow-hidden rounded-2xl border transition-colors',
        hasRunning
          ? 'border-primary/45 ring-1 ring-primary/15'
          : 'border-border/80'
      )}
    >
      {hasRunning && <div className="chat-shimmer-track h-[2px] w-full bg-primary/15" />}

      <button
        type="button"
        onClick={() => setManualOpen((prev) => !(prev ?? isOpen))}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-muted/35"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border shadow-sm',
              hasRunning
                ? 'border-primary/35 bg-primary/15 text-primary'
                : errorCount > 0
                  ? 'border-amber-500/35 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'border-emerald-500/35 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            )}
          >
            {hasRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderGit2 className="h-3.5 w-3.5" />
            )}
          </span>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-semibold tracking-tight text-foreground">
              {hasRunning
                ? hasEmergentTool
                  ? 'Emergent Agent sedang mengeksekusi...'
                  : 'Mengakses Repository GitHub...'
                : hasEmergentTool
                  ? 'Emergent Agent Trace'
                  : 'GitHub MCP Trace'}
            </span>

            <span className="shrink-0 rounded-full border border-border/75 bg-background/75 px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
              {doneCount}/{events.length} step
            </span>

            {errorCount > 0 && (
              <span className="shrink-0 rounded-full border border-destructive/40 bg-destructive/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-destructive">
                {errorCount} error
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/65 bg-background/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <span className="hidden sm:inline">{isOpen ? 'Tutup' : 'Trace'}</span>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="max-h-72 overflow-y-auto border-t border-border/65 bg-background/45 px-3.5 py-3 text-xs">
          <div className="relative space-y-2 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-border/80">
            {events.map((ev) => (
              <div key={ev.id} className="relative flex min-w-0 items-start gap-2.5">
                <span
                  className={cn(
                    'relative z-10 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm',
                    ev.status === 'running'
                      ? 'border-primary/50 text-primary'
                      : ev.status === 'error'
                        ? 'border-destructive/50 text-destructive'
                        : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                  )}
                >
                  {ev.status === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : ev.status === 'error' ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                </span>

                <div
                  className={cn(
                    'flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border px-3 py-2 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-3',
                    ev.status === 'error'
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : ev.status === 'running'
                        ? 'border-primary/40 bg-primary/[0.06]'
                        : 'border-border/70 bg-card/85'
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span
                      title={`${ev.name}(${ev.argsSummary})`}
                      className="min-w-0 flex-1 truncate font-mono text-[11px]"
                    >
                      <span className="font-semibold text-foreground">{ev.name}</span>
                      <span className="text-muted-foreground">({ev.argsSummary})</span>
                    </span>
                  </div>
                  {ev.resultSummary && (
                    <span
                      title={ev.resultSummary}
                      className="min-w-0 max-w-full truncate rounded-md border border-border/65 bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground sm:max-w-[44%] sm:shrink-0"
                    >
                      {ev.resultSummary}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
