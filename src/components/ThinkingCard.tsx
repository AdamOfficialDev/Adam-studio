import { memo, useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Loader2, RefreshCw, Sparkles } from 'lucide-react';
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
}

export const ThinkingCard = memo(function ThinkingCard({
  thought = '',
  statusText,
  isStreaming = false,
  hasAnswerStarted,
  thinkingDurationMs,
  thinkingEnabled,
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
  if (!hasThoughtText && !statusText && !(isActivelyThinking && thinkingEnabled)) {
    return null;
  }

  const isOpen = manualOpen ?? autoOpen;

  const displaySeconds = isActivelyThinking
    ? (elapsedMs / 1000).toFixed(1)
    : thinkingDurationMs && thinkingDurationMs > 0
      ? (thinkingDurationMs / 1000).toFixed(1)
      : null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border transition-colors',
        statusText
          ? 'border-amber-500/40 bg-amber-500/[0.05]'
          : isActivelyThinking
            ? 'border-primary/40 bg-primary/[0.04] shadow-sm'
            : 'border-border/80 bg-muted/25'
      )}
    >
      <button
        type="button"
        onClick={() => setManualOpen((prev) => !(prev ?? autoOpen))}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-muted/40"
      >
        <div className="flex min-w-0 items-center gap-2">
          {statusText && isActivelyThinking ? (
            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
          ) : isActivelyThinking ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <Brain className="h-3.5 w-3.5 shrink-0 text-primary" />
          )}

          <span className="truncate font-semibold text-foreground">
            {isActivelyThinking
              ? statusText
                ? 'Menghubungkan ulang...'
                : hasThoughtText
                  ? 'Thinking...'
                  : 'Sedang berpikir & merencanakan...'
              : displaySeconds
                ? `Thought for ${displaySeconds}s`
                : 'Thinking Process'}
          </span>

          {isActivelyThinking && displaySeconds && (
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-medium text-primary">
              {displaySeconds}s
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">{isOpen ? 'Sembunyikan' : 'Lihat isi'}</span>
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border/60 bg-background/40">
          {statusText && isActivelyThinking && (
            <div className="border-b border-amber-500/20 bg-amber-500/10 px-3.5 py-2 text-[11px] text-amber-300">
              {statusText}
            </div>
          )}

          {hasThoughtText ? (
            <StudioScroll ref={scrollRef} className="max-h-[260px] w-full" autoHide="scroll">
              <div className="px-3.5 py-3 text-xs text-muted-foreground [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_li]:text-xs [&_li]:leading-5 [&_p]:text-xs [&_p]:leading-6 [&_strong]:text-foreground/90">
                <MarkdownRenderer content={thought} isStreaming={isActivelyThinking} />
                {isActivelyThinking && (
                  <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-primary align-middle" />
                )}
              </div>
            </StudioScroll>
          ) : (
            !statusText && (
              <div className="flex items-center gap-2.5 px-3.5 py-3 text-xs text-muted-foreground">
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
