import { memo, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Crosshair,
  FileAudio,
  FileCode2,
  FileText,
  FileVideo,
  GitBranch,
  Globe,
  Link2,
  Layers,
  Pencil,
  Play,
  RefreshCw,
  Square,
  Star,
  User,
  Volume2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { BrandLogoMark } from '@/components/BrandLogo';
import { EmergentClarificationCard } from '@/components/EmergentPlanCard';
import { ThinkingCard } from '@/components/ThinkingCard';
import { ToolTraceCard } from '@/components/ToolTraceCard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { extractArtifactsFromMarkdown } from '@/lib/artifacts';
import { estimateCostUsd } from '@/lib/models';
import { speakMessageAloud, stopSpeechAloud } from '@/lib/speech';
import type { ArtifactItem, ChatMessage as ChatMessageType } from '@/types/chat';
import { cn, copyToClipboard } from '@/lib/utils';

interface ChatMessageProps {
  message: ChatMessageType;
  isLastAssistant: boolean;
  compact: boolean;
  thinkingEnabled?: boolean;
  onContinue?: () => void;
  onRegenerate?: () => void;
  onRetryWithModel?: (modelId: string) => void;
  onEditUserMessage?: (messageId: string, newContent: string) => void;
  onForkFromMessage?: (messageId: string) => void;
  onToggleStar?: (messageId: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
  onPreviewImage: (url: string) => void;
  onSubmitClarification?: (messageId: string, replyText: string, summaryText: string) => void;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastAssistant,
  compact,
  thinkingEnabled = true,
  onContinue,
  onRegenerate,
  onRetryWithModel,
  onEditUserMessage,
  onForkFromMessage,
  onToggleStar,
  onOpenArtifact,
  onPreviewImage,
  onSubmitClarification,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [speaking, setSpeaking] = useState(false);
  const [targetCodeOpen, setTargetCodeOpen] = useState(true);

  useEffect(() => {
    return () => {
      if (speaking) stopSpeechAloud();
    };
  }, [speaking, message.id]);

  const isUser = message.role === 'user';
  const costLabel = estimateCostUsd(message.model || 'gemini-4-hydrogen', message.usage);

  const artifacts = useMemo(() => {
    if (isUser || message.isStreaming || !message.content) return [];
    return extractArtifactsFromMarkdown(message.id, message.content);
  }, [isUser, message.content, message.id, message.isStreaming]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(message.content);
    if (ok) {
      setCopied(true);
      toast.success('Pesan disalin');
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error('Gagal menyalin');
    }
  };

  const handleReadAloud = () => {
    if (speaking) {
      stopSpeechAloud();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    const ok = speakMessageAloud(message.content, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: (errMsg) => {
        setSpeaking(false);
        toast.error(errMsg);
      },
    });
    if (!ok) setSpeaking(false);
  };

  const handleSaveEdit = () => {
    const trimmed = editDraft.trim();
    if (!trimmed || !onEditUserMessage) return;
    setIsEditing(false);
    onEditUserMessage(message.id, trimmed);
  };

  if (isUser) {
    const hasMarkdownCode = message.content.includes('```');
    const visualTargetMarkdown = message.visualTarget
      ? `\`\`\`html\n${message.visualTarget.outerHtml}\n\`\`\``
      : '';

    return (
      <div className="group flex w-full min-w-0 justify-end gap-2.5 sm:gap-3.5">
        <div
          className={cn(
            'min-w-0 space-y-2',
            message.visualTarget || hasMarkdownCode
              ? 'w-full max-w-[92%] sm:max-w-[82%]'
              : 'max-w-[88%] sm:max-w-[76%]'
          )}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((att) =>
                att.kind === 'image' && att.previewUrl ? (
                  <div
                    key={att.id}
                    className="group/img relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-md ring-1 ring-inset ring-foreground/[0.05]"
                  >
                    <button
                      type="button"
                      onClick={() => onPreviewImage(att.previewUrl!)}
                      className="block transition-transform duration-300 group-hover/img:scale-[1.03]"
                    >
                      <img src={att.previewUrl} alt={att.name} className="max-h-52 object-cover" />
                    </button>
                    {typeof att.tokenCount === 'number' && (
                      <span className="absolute bottom-2 right-2 rounded-lg border border-white/15 bg-black/75 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-md">
                        {att.tokenExact ? '' : '~'}
                        {att.tokenCount.toLocaleString()} tok
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    key={att.id}
                    className="chat-card-surface inline-flex max-w-full items-center gap-2 rounded-xl border border-border/80 px-3 py-1.5 text-xs text-muted-foreground"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/80">
                      {att.kind === 'video' ? (
                        <FileVideo className="h-3.5 w-3.5 text-primary" />
                      ) : att.kind === 'audio' ? (
                        <FileAudio className="h-3.5 w-3.5 text-primary" />
                      ) : att.kind === 'pdf' ? (
                        <FileText className="h-3.5 w-3.5 text-rose-500" />
                      ) : (
                        <FileCode2 className="h-3.5 w-3.5 text-primary" />
                      )}
                    </span>
                    <span className="max-w-[160px] truncate font-mono text-[11.5px] font-medium text-foreground">
                      {att.name}
                    </span>
                    {typeof att.tokenCount === 'number' && (
                      <Badge
                        variant="secondary"
                        className="rounded-md px-1.5 py-0 font-mono text-[10px] tabular-nums"
                      >
                        {att.tokenExact ? '' : '~'}
                        {att.tokenCount.toLocaleString()} tok
                      </Badge>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {isEditing ? (
            <div className="chat-card-surface w-full min-w-[240px] space-y-2.5 rounded-2xl border border-primary/45 p-3.5 ring-1 ring-primary/20 sm:min-w-[440px]">
              <Textarea
                autoFocus
                rows={3}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveEdit();
                  } else if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditDraft(message.content);
                  }
                }}
                className="resize-y border-border/80 bg-background/70 text-sm leading-relaxed"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                  ⌘/Ctrl+Enter simpan · Esc batal
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setEditDraft(message.content);
                    }}
                  >
                    Batal
                  </Button>
                  <Button type="button" size="sm" onClick={handleSaveEdit}>
                    Simpan & Kirim Ulang
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative min-w-0">
              <div
                className={cn(
                  'chat-user-surface min-w-0 overflow-hidden rounded-2xl rounded-tr-md border border-border/80 px-4 text-[15px] leading-relaxed text-foreground',
                  compact ? 'py-2.5' : 'py-3.5'
                )}
              >
                {message.visualTarget && (
                  <div className="mb-3 overflow-hidden rounded-xl border border-primary/30 bg-background/60">
                    <button
                      type="button"
                      onClick={() => setTargetCodeOpen((o) => !o)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Crosshair className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate font-mono">
                          Visual Target: &lt;{message.visualTarget.selector}&gt;
                        </span>
                      </span>
                      {targetCodeOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>

                    {targetCodeOpen && (
                      <div className="border-t border-border/50 px-2 pb-1 [&_div.my-4]:my-2">
                        <MarkdownRenderer
                          content={visualTargetMarkdown}
                          onOpenArtifact={onOpenArtifact}
                        />
                      </div>
                    )}
                  </div>
                )}

                {hasMarkdownCode ? (
                  <MarkdownRenderer
                    content={message.content}
                    onOpenArtifact={onOpenArtifact}
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {message.content}
                  </p>
                )}
              </div>

              <div className="mt-1.5 flex justify-end opacity-90 transition-opacity duration-150 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                <div className="chat-action-dock inline-flex items-center gap-0.5 rounded-xl border border-border/70 p-0.5 backdrop-blur-sm">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    className="h-6 gap-1 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    title="Salin pesan"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    <span>{copied ? 'Disalin' : 'Salin'}</span>
                  </Button>
                  {onEditUserMessage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditDraft(message.content);
                        setIsEditing(true);
                      }}
                      className="h-6 gap-1 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                      <span>Edit</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <Avatar className="mt-0.5 h-7 w-7 shrink-0 border border-primary/30 shadow-sm ring-2 ring-primary/15 sm:h-8 sm:w-8">
          <AvatarFallback className="bg-gradient-to-br from-primary/25 via-primary/15 to-primary/5 text-primary">
            <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  const hasAnswerStarted = Boolean(message.content && message.content.length > 0);
  const hasResumableState = Boolean(
    message.content?.trim() ||
      message.thought?.trim() ||
      (message.toolEvents && message.toolEvents.length > 0)
  );
  const isIncomplete = Boolean(message.error || message.stopped);
  const canContinue = isIncomplete && hasResumableState;
  const isCapacityError = Boolean(
    message.error && /high demand|503|429|quota|rate limit|overloaded/i.test(message.error)
  );

  return (
    <div className="group flex w-full min-w-0 items-start gap-2.5 sm:gap-3.5">
      <Avatar
        className={cn(
          'mt-0.5 h-7 w-7 shrink-0 border border-primary/35 bg-primary transition-shadow sm:h-8 sm:w-8',
          message.isStreaming
            ? 'shadow-[0_0_24px_-4px_hsl(var(--primary)/0.65)] ring-2 ring-primary/35'
            : 'shadow-sm ring-2 ring-primary/15'
        )}
      >
        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
          <BrandLogoMark
            className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4', message.isStreaming && 'animate-pulse')}
          />
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-2.5 py-0.5 text-xs font-semibold tracking-tight text-foreground shadow-sm">
            <Cpu className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate">{message.model || 'gemini-4-hydrogen'}</span>
          </span>

          {message.starred && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 bg-amber-500/10 px-2 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-300"
            >
              <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
              Starred
            </Badge>
          )}

          {message.isDemo && (
            <Badge variant="outline" className="px-2 py-0 text-[10px] font-normal">
              Demo SSE
            </Badge>
          )}

          {message.stopped && !message.error && !message.isStreaming && (
            <Badge
              variant="outline"
              className="border-amber-500/35 bg-amber-500/10 px-2 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-300"
            >
              Dihentikan
            </Badge>
          )}

          {message.isStreaming && (
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary shadow-sm">
              <span className="flex h-3 items-end gap-[2px]">
                <span className="chat-wave-bar h-2.5 w-[2px] rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="chat-wave-bar h-3 w-[2px] rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="chat-wave-bar h-2 w-[2px] rounded-full bg-primary" />
              </span>
              {hasAnswerStarted ? 'Streaming' : 'Thinking'}
            </span>
          )}
        </div>

        <ThinkingCard
          thought={message.thought}
          statusText={message.statusText}
          isStreaming={message.isStreaming}
          hasAnswerStarted={hasAnswerStarted}
          thinkingDurationMs={message.metrics?.thinkingDurationMs}
          thinkingEnabled={thinkingEnabled}
        />

        <ToolTraceCard events={message.toolEvents} isStreaming={message.isStreaming} />

        {message.clarification && (
          <EmergentClarificationCard
            clarification={message.clarification}
            isStreaming={message.isStreaming}
            onSubmit={(replyText, summaryText) =>
              onSubmitClarification?.(message.id, replyText, summaryText)
            }
          />
        )}

        {message.content ? (
          <div className="relative w-full min-w-0">
            <MarkdownRenderer
              content={message.content}
              isStreaming={message.isStreaming}
              onOpenArtifact={onOpenArtifact}
            />
            {message.isStreaming && (
              <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />
            )}
          </div>
        ) : (
          message.isStreaming &&
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

        {message.grounding &&
          ((message.grounding.sources && message.grounding.sources.length > 0) ||
            (message.grounding.urlContexts && message.grounding.urlContexts.length > 0) ||
            (message.grounding.webSearchQueries && message.grounding.webSearchQueries.length > 0)) && (
            <div className="chat-card-surface mt-2 overflow-hidden rounded-2xl border border-border/80 px-3.5 py-3 text-xs">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-foreground/90">
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md border border-primary/25 bg-primary/15 text-primary">
                    <Globe className="h-3 w-3" />
                  </span>
                  <span>Sumber Grounding & URL Context</span>
                  {message.grounding.sources && message.grounding.sources.length > 0 && (
                    <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[10px]">
                      {message.grounding.sources.length}
                    </Badge>
                  )}
                </span>
                {message.grounding.webSearchQueries &&
                  message.grounding.webSearchQueries.length > 0 && (
                    <span className="max-w-full truncate rounded-lg border border-border/70 bg-background/75 px-2 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                      Query: {message.grounding.webSearchQueries.slice(0, 2).join(' · ')}
                    </span>
                  )}
              </div>

              {message.grounding.urlContexts && message.grounding.urlContexts.length > 0 && (
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {message.grounding.urlContexts.map((u, idx) => {
                    const isFailed = Boolean(
                      u.status && /error|fail|unsafe|unavailable|timeout/i.test(u.status)
                    );
                    return (
                      <a
                        key={`url-${idx}`}
                        href={u.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          'inline-flex max-w-full items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] transition-colors',
                          isFailed
                            ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'
                            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
                        )}
                        title={u.status || u.url}
                      >
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="max-w-[220px] truncate">{u.url}</span>
                        {isFailed && (
                          <span className="rounded bg-amber-500/20 px-1 text-[9px] font-semibold">
                            Gagal
                          </span>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}

              {message.grounding.sources && message.grounding.sources.length > 0 && (
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {message.grounding.sources.map((src, idx) => {
                    let host = src.uri;
                    try {
                      host = new URL(src.uri).hostname.replace(/^www\./, '');
                    } catch {
                      // keep raw
                    }
                    return (
                      <a
                        key={`src-${idx}`}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/src flex min-w-0 items-center gap-2 rounded-xl border border-border/75 bg-background/75 px-2.5 py-2 text-[11px] text-foreground/90 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-accent/40"
                        title={src.title || src.uri}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-[10px] font-semibold text-primary">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground group-hover/src:text-primary">
                            {src.title || host}
                          </div>
                          <div className="truncate font-mono text-[9.5px] text-muted-foreground">
                            {host}
                          </div>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-50 transition-all group-hover/src:translate-x-0.5 group-hover/src:-translate-y-0.5 group-hover/src:text-primary group-hover/src:opacity-100" />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        {artifacts.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {artifacts.map((art) => (
              <button
                key={art.id}
                type="button"
                onClick={() => onOpenArtifact(art)}
                className="chat-card-surface group/art inline-flex max-w-full items-center gap-2.5 rounded-2xl border border-border/80 px-3.5 py-2 text-xs font-medium transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/15 text-primary transition-colors group-hover/art:bg-primary group-hover/art:text-primary-foreground">
                  <Layers className="h-3.5 w-3.5" />
                </span>
                <span className="truncate font-semibold text-foreground">{art.title}</span>
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-md px-1.5 py-0 font-mono text-[10px] uppercase"
                >
                  {art.language}
                </Badge>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover/art:translate-x-0.5 group-hover/art:-translate-y-0.5 group-hover/art:text-primary" />
              </button>
            ))}
          </div>
        )}

        {message.error && (
          <div className="space-y-2.5 rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <div className="font-semibold">Gagal menerima stream SSE</div>
                <p className="break-words leading-relaxed opacity-90">{message.error}</p>
                {isCapacityError && (
                  <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Server Google Developer API sedang mengalami lonjakan trafik (503/429). Web{' '}
                    <code>aistudio.google.com</code> memakai pool konsol terpisah.
                  </p>
                )}
              </div>
            </div>

            {isLastAssistant && (
              <div className="flex flex-wrap gap-2 pt-1">
                {onContinue && canContinue && (
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={onContinue}
                    className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px]"
                    title="Lanjutkan dari state terakhir tanpa mengulang tool/teks yang sudah berjalan"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Continue
                  </Button>
                )}
                {onRegenerate && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onRegenerate}
                    className="h-7 gap-1.5 rounded-lg border-destructive/30 bg-background/60 px-2.5 text-[11px] text-foreground hover:bg-background"
                    title="Hapus percobaan ini dan ulangi dari awal"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {canContinue ? 'Regenerate' : 'Coba Lagi'}
                  </Button>
                )}
                {isCapacityError && onRetryWithModel && message.model !== 'gemini-3.8-flash' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRetryWithModel('gemini-3.8-flash')}
                    className="h-7 rounded-lg border-primary/30 bg-background/60 px-2.5 text-[11px] text-foreground hover:bg-background"
                  >
                    Coba Gemini 3.8 Flash
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {!message.isStreaming && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <div className="chat-action-dock inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-border/75 p-0.5 backdrop-blur-sm">
              {message.content && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    className="h-7 gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleReadAloud}
                    className={cn(
                      'h-7 gap-1 rounded-lg px-2 text-xs hover:text-foreground',
                      speaking ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
                    )}
                  >
                    {speaking ? (
                      <>
                        <Square className="h-3 w-3 fill-current text-primary" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>Read</span>
                      </>
                    )}
                  </Button>

                  {onToggleStar && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onToggleStar(message.id)}
                      className={cn(
                        'h-7 gap-1 rounded-lg px-2 text-xs hover:text-foreground',
                        message.starred
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'text-muted-foreground'
                      )}
                    >
                      <Star
                        className={cn(
                          'h-3.5 w-3.5',
                          message.starred && 'fill-amber-500 text-amber-500'
                        )}
                      />
                      <span>{message.starred ? 'Starred' : 'Star'}</span>
                    </Button>
                  )}
                </>
              )}

              {onForkFromMessage && message.content && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onForkFromMessage(message.id)}
                  className="h-7 gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>Fork</span>
                </Button>
              )}

              {isLastAssistant && onContinue && canContinue && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onContinue}
                  className="h-7 gap-1 rounded-lg bg-primary/15 px-2.5 text-xs font-medium text-primary hover:bg-primary/25 hover:text-primary"
                  title="Lanjutkan dari state terakhir tanpa mengulang dari awal"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Continue</span>
                </Button>
              )}

              {isLastAssistant && onRegenerate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRegenerate}
                  className="h-7 gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Regenerate</span>
                </Button>
              )}
            </div>

            {(message.usage?.totalTokenCount || message.metrics?.ttftMs) && (
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                {message.metrics?.ttftMs && (
                  <span
                    title="Time to First Token"
                    className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/75 px-2 py-0.5 tabular-nums"
                  >
                    <Zap className="h-3 w-3 text-amber-500" />
                    {message.metrics.ttftMs}ms
                  </span>
                )}
                {message.metrics?.tokensPerSec && (
                  <span
                    title="Kecepatan Generasi"
                    className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/75 px-2 py-0.5 tabular-nums"
                  >
                    <Activity className="h-3 w-3 text-emerald-500" />
                    {message.metrics.tokensPerSec} tok/s
                  </span>
                )}
                {message.metrics?.durationMs && (
                  <span
                    title="Durasi Total"
                    className="hidden items-center gap-1 rounded-lg border border-border/70 bg-card/75 px-2 py-0.5 tabular-nums sm:inline-flex"
                  >
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {(message.metrics.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
                {message.usage?.totalTokenCount && (
                  <span
                    title="Input / Output Token & Estimasi Biaya"
                    className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/75 px-2 py-0.5 tabular-nums"
                  >
                    {message.usage.promptTokenCount ?? 0}/{message.usage.candidatesTokenCount ?? 0}
                    {costLabel ? ` • ${costLabel}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
