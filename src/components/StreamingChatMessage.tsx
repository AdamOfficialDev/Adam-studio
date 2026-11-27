import { memo, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Check, Cpu, FileCode2, Globe, Link2, ShieldAlert, X } from 'lucide-react';
import { BrandLogoMark } from '@/components/BrandLogo';
import { ChatMessage } from '@/components/ChatMessage';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ThinkingCard } from '@/components/ThinkingCard';
import { EmergentClarificationCard, EmergentPlanCard } from '@/components/EmergentPlanCard';
import { ToolTraceCard } from '@/components/ToolTraceCard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMessageStreamOverride } from '@/lib/streamStore';
import type { ArtifactItem, ChatMessage as ChatMessageType, EmergentPlan } from '@/types/chat';

interface StreamingChatMessageProps {
  convId: string;
  message: ChatMessageType;
  compact: boolean;
  thinkingEnabled: boolean;
  isLastAssistant: boolean;
  isStreamingGlobal: boolean;
  onContinue?: () => void;
  onRegenerate?: () => void;
  onRetryWithModel?: (modelId: string) => void;
  onEditUserMessage?: (messageId: string, newContent: string) => void;
  onForkFromMessage?: (messageId: string) => void;
  onToggleStar?: (messageId: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
  onPreviewImage: (url: string) => void;
  onSubmitClarification?: (messageId: string, replyText: string, summaryText: string) => void;
  livePlan?: EmergentPlan | null;
  workspaceFileCount?: number;
  onOpenWorkspace?: () => void;
  onResolveDeviceApproval?: (approvalId: string, approved: boolean) => void | Promise<void>;
}

function splitStreamingContent(content: string): {
  frozenPrefix: string;
  activeTail: string;
  openFenceLang: string | null;
  openFenceCode: string;
} {
  if (!content) {
    return { frozenPrefix: '', activeTail: '', openFenceLang: null, openFenceCode: '' };
  }

  const lines = content.split('\n');
  let inFence = false;
  let fenceStartLine = -1;
  let fenceLang = '';
  let lastSafeParagraphLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceStartLine = i;
        fenceLang = trimmed.slice(3).trim();
      } else {
        inFence = false;
        fenceStartLine = -1;
        fenceLang = '';
      }
    } else if (!inFence && trimmed === '' && i > 0 && i < lines.length - 2) {
      lastSafeParagraphLine = i;
    }
  }

  if (inFence && fenceStartLine !== -1) {
    const prefixLines = lines.slice(0, fenceStartLine);
    return {
      frozenPrefix: prefixLines.join('\n'),
      activeTail: '',
      openFenceLang: fenceLang || 'code',
      openFenceCode: lines.slice(fenceStartLine + 1).join('\n'),
    };
  }

  if (lastSafeParagraphLine > 0 && content.length > 1600) {
    return {
      frozenPrefix: lines.slice(0, lastSafeParagraphLine).join('\n'),
      activeTail: lines.slice(lastSafeParagraphLine + 1).join('\n'),
      openFenceLang: null,
      openFenceCode: '',
    };
  }

  return { frozenPrefix: '', activeTail: content, openFenceLang: null, openFenceCode: '' };
}

export const StreamingChatMessage = memo(function StreamingChatMessage({
  convId,
  message,
  compact,
  thinkingEnabled,
  isLastAssistant,
  isStreamingGlobal,
  onContinue,
  onRegenerate,
  onRetryWithModel,
  onEditUserMessage,
  onForkFromMessage,
  onToggleStar,
  onOpenArtifact,
  onPreviewImage,
  onSubmitClarification,
  livePlan = null,
  workspaceFileCount = 0,
  onOpenWorkspace,
  onResolveDeviceApproval,
}: StreamingChatMessageProps) {
  const override = useMessageStreamOverride(convId, message.id);
  const [resolvingApproval, setResolvingApproval] = useState(false);

  const split = useMemo(() => {
    if (!override) return null;
    return splitStreamingContent(override.content);
  }, [override]);

  if (!override || !split) {
    return (
      <ChatMessage
        message={message}
        compact={compact}
        thinkingEnabled={thinkingEnabled}
        isLastAssistant={isLastAssistant}
        onContinue={isLastAssistant && !isStreamingGlobal ? onContinue : undefined}
        onRegenerate={isLastAssistant && !isStreamingGlobal ? onRegenerate : undefined}
        onRetryWithModel={isLastAssistant && !isStreamingGlobal ? onRetryWithModel : undefined}
        onEditUserMessage={
          message.role === 'user' && !isStreamingGlobal ? onEditUserMessage : undefined
        }
        onForkFromMessage={
          message.role === 'assistant' && !isStreamingGlobal ? onForkFromMessage : undefined
        }
        onToggleStar={onToggleStar}
        onOpenArtifact={onOpenArtifact}
        onPreviewImage={onPreviewImage}
        onSubmitClarification={onSubmitClarification}
      />
    );
  }

  const hasAnswerStarted = override.content.length > 0;
  const openLinesCount = split.openFenceCode ? split.openFenceCode.split('\n').length : 0;

  return (
    <div className="group flex w-full min-w-0 items-start gap-2.5 sm:gap-3.5">
      <Avatar className="mt-0.5 h-7 w-7 shrink-0 border border-primary/40 bg-primary shadow-[0_0_24px_-4px_hsl(var(--primary)/0.65)] ring-2 ring-primary/35 sm:h-8 sm:w-8">
        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
          <BrandLogoMark className="h-3.5 w-3.5 animate-pulse sm:h-4 sm:w-4" />
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 py-0.5 text-xs font-semibold tracking-tight text-foreground shadow-sm">
            <Cpu className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate">{message.model || 'gemini-4-hydrogen'}</span>
          </span>

          <span className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary shadow-sm">
            <span className="flex h-3 items-end gap-[2px]">
              <span className="chat-wave-bar h-2.5 w-[2px] rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="chat-wave-bar h-3 w-[2px] rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="chat-wave-bar h-2 w-[2px] rounded-full bg-primary" />
            </span>
            {override.statusText ? 'Rotating Key' : hasAnswerStarted ? 'Streaming' : 'Thinking'}
          </span>

          {override.tps > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/35 bg-emerald-500/10 font-mono text-[10px] tabular-nums text-emerald-700 dark:text-emerald-300"
            >
              <Activity className="h-2.5 w-2.5" />
              {override.tps} tok/s
            </Badge>
          )}
        </div>

        <ThinkingCard
          thought={override.thought}
          statusText={override.statusText}
          isStreaming={true}
          hasAnswerStarted={hasAnswerStarted}
          thinkingDurationMs={override.thinkingDurationMs}
          thinkingEnabled={thinkingEnabled}
          hasTools={Boolean(override.toolEvents?.length)}
        />

        {livePlan && (
          <EmergentPlanCard
            plan={livePlan}
            fileCount={workspaceFileCount}
            onOpenWorkspace={onOpenWorkspace}
          />
        )}
        <ToolTraceCard events={override.toolEvents} isStreaming={true} />

        {(override.clarification || message.clarification) && (
          <EmergentClarificationCard
            clarification={(override.clarification || message.clarification)!}
            isStreaming={true}
            onSubmit={(replyText, summaryText) =>
              onSubmitClarification?.(message.id, replyText, summaryText)
            }
          />
        )}

        {override.deviceApproval && (
          <div className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-3.5 shadow-md">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-amber-300">
                    Izin Eksekusi Device ({override.deviceApproval.riskLevel.toUpperCase()})
                  </span>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                    {override.deviceApproval.toolName}
                  </span>
                </div>
                <p className="text-xs text-foreground">{override.deviceApproval.summary}</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={resolvingApproval}
                    onClick={async () => {
                      if (!override.deviceApproval || !onResolveDeviceApproval) return;
                      setResolvingApproval(true);
                      try {
                        await onResolveDeviceApproval(override.deviceApproval.approvalId, true);
                      } finally {
                        setResolvingApproval(false);
                      }
                    }}
                    className="h-7 gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-500"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Izinkan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={resolvingApproval}
                    onClick={async () => {
                      if (!override.deviceApproval || !onResolveDeviceApproval) return;
                      setResolvingApproval(true);
                      try {
                        await onResolveDeviceApproval(override.deviceApproval.approvalId, false);
                      } finally {
                        setResolvingApproval(false);
                      }
                    }}
                    className="h-7 gap-1.5 rounded-lg px-3 text-xs"
                  >
                    <X className="h-3.5 w-3.5" />
                    Tolak
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {override.grounding &&
          ((override.grounding.sources && override.grounding.sources.length > 0) ||
            (override.grounding.urlContexts && override.grounding.urlContexts.length > 0)) && (
            <div className="chat-card-surface flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/80 px-3 py-2.5 text-[11px]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                <span className="flex h-5 w-5 items-center justify-center rounded-md border border-primary/25 bg-primary/15">
                  <Globe className="h-3 w-3" />
                </span>
                Grounding:
              </span>
              {override.grounding.urlContexts?.map((u, idx) => (
                <a
                  key={`surl-${idx}`}
                  href={u.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-[200px] items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300"
                >
                  <Link2 className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{u.url}</span>
                </a>
              ))}
              {override.grounding.sources?.slice(0, 6).map((src, idx) => (
                <a
                  key={`ssrc-${idx}`}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/ssrc inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border border-border/75 bg-background/75 px-2 py-0.5 text-[10px] text-foreground/90 transition-colors hover:border-primary/45 hover:text-primary"
                >
                  <span className="rounded bg-primary/15 px-1 font-mono text-[9px] font-semibold text-primary">
                    {idx + 1}
                  </span>
                  <span className="truncate">{src.title || src.uri}</span>
                  <ArrowUpRight className="h-2.5 w-2.5 shrink-0 opacity-45 group-hover/ssrc:opacity-100" />
                </a>
              ))}
            </div>
          )}

        {hasAnswerStarted ? (
          <div className="w-full min-w-0 space-y-2" data-assistant-selectable="true">
            {split.frozenPrefix && (
              <MarkdownRenderer
                content={split.frozenPrefix}
                isStreaming={false}
                onOpenArtifact={onOpenArtifact}
              />
            )}

            {split.activeTail && (
              <MarkdownRenderer
                content={split.activeTail}
                isStreaming={true}
                onOpenArtifact={onOpenArtifact}
              />
            )}

            {split.openFenceLang !== null && (
              <div className="my-3 w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#0b0d12] text-zinc-100 shadow-xl ring-1 ring-white/[0.06]">
                <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-3.5 py-2 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="hidden items-center gap-1.5 sm:flex">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500/75" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500/75" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/75" />
                    </div>
                    <span className="flex items-center gap-1.5 rounded-md bg-zinc-800/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-zinc-200">
                      <FileCode2 className="h-3.5 w-3.5 text-primary" />
                      {split.openFenceLang}
                    </span>
                  </div>
                  <span className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] text-sky-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                    Streaming {openLinesCount} lines...
                  </span>
                </div>
                <pre className="max-h-[340px] w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words p-3.5 font-mono text-[12.5px] leading-[1.6] text-zinc-200">
                  {split.openFenceCode}
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />
                </pre>
              </div>
            )}

            {split.openFenceLang === null && (
              <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />
            )}
          </div>
        ) : (
          !thinkingEnabled && (
            <div className="inline-flex items-center gap-2.5 rounded-2xl border border-border/75 bg-card/70 px-3.5 py-2 text-xs text-muted-foreground">
              <span className="flex h-3.5 items-end gap-[2.5px]">
                <span className="chat-wave-bar h-3 w-[2.5px] rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="chat-wave-bar h-3.5 w-[2.5px] rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="chat-wave-bar h-2.5 w-[2.5px] rounded-full bg-primary" />
              </span>
              <span>Menyusun respons...</span>
            </div>
          )
        )}
      </div>
    </div>
  );
});
