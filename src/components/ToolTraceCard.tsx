import { memo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Loader2,
  Wrench,
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
  const isOpen = manualOpen ?? (isStreaming && hasRunning);

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-border/80 bg-card/60">
      <button
        type="button"
        onClick={() => setManualOpen((prev) => !(prev ?? isOpen))}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 sm:px-3.5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {hasRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          )}
          <span className="truncate font-semibold text-foreground">
            {hasRunning
              ? 'Membaca Repository GitHub...'
              : `GitHub MCP Tools (${events.length} langkah)`}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">{isOpen ? 'Tutup' : 'Detail'}</span>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="max-h-64 space-y-1.5 overflow-y-auto border-t border-border/60 bg-background/40 px-2.5 py-2 text-xs sm:px-3 sm:py-2.5">
          {events.map((ev) => (
            <div
              key={ev.id}
              className={cn(
                'flex min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2',
                ev.status === 'error'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-border/60 bg-card/70'
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                {ev.status === 'running' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : ev.status === 'error' ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                )}
                <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span
                  title={`${ev.name}(${ev.argsSummary})`}
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
                >
                  {ev.name}({ev.argsSummary})
                </span>
              </div>
              {ev.resultSummary && (
                <span
                  title={ev.resultSummary}
                  className="min-w-0 max-w-full truncate pl-[38px] font-mono text-[10px] text-muted-foreground sm:max-w-[46%] sm:shrink-0 sm:pl-0 sm:text-right"
                >
                  {ev.resultSummary}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
