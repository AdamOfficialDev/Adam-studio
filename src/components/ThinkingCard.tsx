import { memo, useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Clock, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { StudioScroll, type StudioScrollHandle } from '@/components/ui/studio-scroll';
import { cn } from '@/lib/utils';

interface ThinkingCardProps {
  thought?: string;
  statusText?: string;
  isStreaming?: boolean;
  hasAnswerStarted: boolean;
  thinkingDurationMs?: number;
  thinkingEnabled: boolean;
  hasTools?: boolean;
}

export const ThinkingCard = memo(function ThinkingCard({
  thought = '',
  statusText,
  isStreaming = false,
  hasAnswerStarted,
  thinkingDurationMs,
  thinkingEnabled,
  hasTools = false,
}: ThinkingCardProps) {
  const isActivelyThinking = Boolean(isStreaming && !hasAnswerStarted);
  const autoOpen = isActivelyThinking;

  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const startedAtRef = useRef<number | null>(null);
  const scrollRef = useRef<StudioScrollHandle | null>(null);

  useEffect(() => {
    if (!isActivelyThinking) {
      startedAtRef.current = null;
      return;
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }

    const timer = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [isActivelyThinking]);

  useEffect(() => {
    if (!isActivelyThinking) return;
    const vp = scrollRef.current?.getViewport();
    if (vp) {
      vp.scrollTop = vp.scrollHeight;
    }
  }, [thought, isActivelyThinking]);

  const hasThoughtText = thought.trim().length > 0;
  if (!hasThoughtText && !statusText && (hasTools || !(isActivelyThinking && thinkingEnabled))) {
    return null;
  }

  const isOpen = manualOpen ?? autoOpen;

  const displaySeconds = isActivelyThinking
    ? (elapsedMs / 1000).toFixed(1)
    : thinkingDurationMs && thinkingDurationMs > 0
      ? (thinkingDurationMs / 1000).toFixed(1)
      : null;

  const thoughtWordCount = hasThoughtText ? thought.trim().split(/\s+/).length : 0;

  return (
    <div
      className={cn(
        'chat-card-surface overflow-hidden rounded-2xl border transition-all duration-200',
        statusText
          ? 'border-amber-500/45 ring-1 ring-amber-500/15'
          : isActivelyThinking
            ? 'border-primary/45 ring-1 ring-primary/20 shadow-[0_12px_34px_-16px_hsl(var(--primary)/0.45)]'
            : 'border-border/80'
      )}
    >
      {isActivelyThinking && (
        <div className="chat-shimmer-track h-[2px] w-full bg-primary/15" />
      )}

      <button
        type="button"
        onClick={() => setManualOpen((prev) => !(prev ?? autoOpen))}
        className="flex w-full items-center justify-between gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-muted/35"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border shadow-sm',
              statusText && isActivelyThinking
                ? 'border-amber-500/35 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : isActivelyThinking
                  ? 'border-primary/35 bg-primary/15 text-primary'
                  : 'border-border/75 bg-background/80 text-primary'
            )}
          >
            {statusText && isActivelyThinking ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : isActivelyThinking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Brain className="h-3.5 w-3.5" />
            )}
          </span>

          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate font-semibold tracking-tight text-foreground">
                {isActivelyThinking
                  ? statusText
                    ? 'Menghubungkan ulang...'
                    : hasThoughtText
                      ? 'Reasoning Process'
                      : 'Menganalisis & menyusun rencana...'
                  : 'Reasoning Process'}
              </span>

              {displaySeconds && (
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums',
                    isActivelyThinking
                      ? 'border-primary/35 bg-primary/15 text-primary'
                      : 'border-border/75 bg-background/75 text-muted-foreground'
                  )}
                >
                  <Clock className="h-2.5 w-2.5" />
                  {displaySeconds}s
                </span>
              )}

              {!isOpen && thoughtWordCount > 0 && (
                <span className="hidden rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
                  {thoughtWordCount.toLocaleString()} kata
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/65 bg-background/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <span className="hidden sm:inline">{isOpen ? 'Tutup' : 'Inspeksi'}</span>
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border/65 bg-background/45">
          {statusText && isActivelyThinking && (
            <div className="border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              {statusText}
            </div>
          )}

          {hasThoughtText ? (
            <StudioScroll ref={scrollRef} className="max-h-[260px] w-full" autoHide="scroll">
              <div className="relative mx-3.5 my-3 border-l-2 border-primary/25 pl-3.5 text-xs text-muted-foreground [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_li]:text-xs [&_li]:leading-5 [&_p]:text-xs [&_p]:leading-6 [&_strong]:text-foreground/95">
                <MarkdownRenderer content={thought} isStreaming={isActivelyThinking} />
                {isActivelyThinking && (
                  <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-primary align-middle" />
                )}
              </div>
            </StudioScroll>
          ) : (
            !statusText && (
              <div className="flex items-center gap-2.5 px-4 py-3 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
                <span>Menunggu model mengirim ringkasan rencana pemikiran...</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
});
