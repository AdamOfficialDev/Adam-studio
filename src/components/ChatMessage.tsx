import { memo, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  FileCode2,
  GitBranch,
  Layers,
  Pencil,
  RefreshCw,
  Square,
  Star,
  User,
  Volume2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { BrandLogoMark } from '@/components/BrandLogo';
import { ThinkingCard } from '@/components/ThinkingCard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { extractArtifactsFromMarkdown } from '@/lib/artifacts';
import { estimateCostUsd } from '@/lib/models';
import type { ArtifactItem, ChatMessage as ChatMessageType } from '@/types/chat';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  message: ChatMessageType;
  isLastAssistant: boolean;
  compact: boolean;
  thinkingEnabled?: boolean;
  onRegenerate?: () => void;
  onRetryWithModel?: (modelId: string) => void;
  onEditUserMessage?: (messageId: string, newContent: string) => void;
  onForkFromMessage?: (messageId: string) => void;
  onToggleStar?: (messageId: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
  onPreviewImage: (url: string) => void;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastAssistant,
  compact,
  thinkingEnabled = true,
  onRegenerate,
  onRetryWithModel,
  onEditUserMessage,
  onForkFromMessage,
  onToggleStar,
  onOpenArtifact,
  onPreviewImage,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [speaking, setSpeaking] = useState(false);

  const isUser = message.role === 'user';
  const costLabel = estimateCostUsd(message.model || 'gemini-4-hydrogen', message.usage);

  const artifacts = useMemo(() => {
    if (isUser || message.isStreaming || !message.content) return [];
    return extractArtifactsFromMarkdown(message.id, message.content);
  }, [isUser, message.content, message.id, message.isStreaming]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success('Pesan disalin');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Gagal menyalin');
    }
  };

  const handleReadAloud = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.error('Browser tidak mendukung Text-to-Speech');
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      message.content.replace(/```[\s\S]*?```/g, ' kode ')
    );
    utterance.lang = 'id-ID';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleSaveEdit = () => {
    const trimmed = editDraft.trim();
    if (!trimmed || !onEditUserMessage) return;
    setIsEditing(false);
    onEditUserMessage(message.id, trimmed);
  };

  if (isUser) {
    return (
      <div className="group flex w-full min-w-0 justify-end gap-2.5 sm:gap-3">
        <div className="min-w-0 max-w-[88%] space-y-2 sm:max-w-[76%]">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((att) =>
                att.kind === 'image' && att.previewUrl ? (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => onPreviewImage(att.previewUrl!)}
                    className="overflow-hidden rounded-xl border shadow-sm transition-transform hover:scale-[1.02]"
                  >
                    <img src={att.previewUrl} alt={att.name} className="max-h-48 object-cover" />
                  </button>
                ) : (
                  <div
                    key={att.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground"
                  >
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate font-mono">{att.name}</span>
                  </div>
                )
              )}
            </div>
          )}

          {isEditing ? (
            <div className="w-full min-w-[240px] space-y-2 rounded-2xl border bg-card p-3 shadow-lg sm:min-w-[420px]">
              <Textarea
                autoFocus
                rows={3}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="text-sm"
              />
              <div className="flex justify-end gap-2">
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
          ) : (
            <div className="relative min-w-0">
              <div
                className={cn(
                  'rounded-2xl rounded-tr-sm border border-border/70 bg-secondary/90 px-4 text-[15px] leading-relaxed text-secondary-foreground shadow-sm',
                  compact ? 'py-2.5' : 'py-3'
                )}
              >
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {message.content}
                </p>
              </div>
              {onEditUserMessage && (
                <div className="mt-1 flex justify-end gap-1 opacity-80 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditDraft(message.content);
                      setIsEditing(true);
                    }}
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <Avatar className="mt-0.5 h-7 w-7 shrink-0 border sm:h-8 sm:w-8">
          <AvatarFallback className="bg-primary/15 text-primary">
            <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  const hasAnswerStarted = Boolean(message.content && message.content.length > 0);
  const isCapacityError = Boolean(
    message.error && /high demand|503|429|quota|rate limit|overloaded/i.test(message.error)
  );

  return (
    <div className="group flex w-full min-w-0 items-start gap-2.5 sm:gap-3.5">
      <Avatar className="mt-0.5 h-7 w-7 shrink-0 border border-primary/25 bg-primary shadow-sm sm:h-8 sm:w-8">
        <AvatarFallback className="bg-primary text-primary-foreground">
          <BrandLogoMark
            className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4', message.isStreaming && 'animate-pulse')}
          />
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-2.5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-xs font-semibold tracking-tight text-foreground">
            {message.model || 'gemini-4-hydrogen'}
          </span>
          {message.isDemo && (
            <Badge variant="outline" className="text-[10px] font-normal">
              Demo SSE
            </Badge>
          )}
          {message.isStreaming && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary" />
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
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
            </div>
          )
        )}

        {artifacts.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {artifacts.map((art) => (
              <button
                key={art.id}
                type="button"
                onClick={() => onOpenArtifact(art)}
                className="inline-flex max-w-full items-center gap-2 rounded-xl border bg-card/90 px-3 py-2 text-xs font-medium shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/50"
              >
                <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{art.title}</span>
                <Badge variant="secondary" className="shrink-0 px-1.5 py-0 font-mono text-[10px]">
                  {art.language}
                </Badge>
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
                    Server Google Developer API sedang mengalami lonjakan trafik (503/429) setelah
                    3x percobaan ulang otomatis. Web <code>aistudio.google.com</code> memakai pool
                    konsol terpisah.
                  </p>
                )}
              </div>
            </div>

            {isLastAssistant && (
              <div className="flex flex-wrap gap-2 pt-1">
                {onRegenerate && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onRegenerate}
                    className="h-7 gap-1.5 rounded-lg border-destructive/30 bg-background/60 px-2.5 text-[11px] text-foreground hover:bg-background"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Coba Lagi
                  </Button>
                )}
                {isCapacityError && onRetryWithModel && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onRetryWithModel('gemini-2.5-pro')}
                      className="h-7 rounded-lg border-primary/30 bg-background/60 px-2.5 text-[11px] text-foreground hover:bg-background"
                    >
                      Coba Gemini 2.5 Pro
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onRetryWithModel('gemini-2.5-flash')}
                      className="h-7 rounded-lg border-primary/30 bg-background/60 px-2.5 text-[11px] text-foreground hover:bg-background"
                    >
                      Coba Gemini 2.5 Flash
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {!message.isStreaming && (
          <div className="flex flex-wrap items-center gap-1 pt-1 text-xs text-muted-foreground">
            {message.content && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
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
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
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
                      'h-7 gap-1 px-2 text-xs hover:text-foreground',
                      message.starred ? 'text-amber-400' : 'text-muted-foreground'
                    )}
                  >
                    <Star className={cn('h-3.5 w-3.5', message.starred && 'fill-amber-400')} />
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
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span>Fork</span>
              </Button>
            )}

            {isLastAssistant && onRegenerate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRegenerate}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Regenerate</span>
              </Button>
            )}

            {(message.usage?.totalTokenCount || message.metrics?.ttftMs) && (
              <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[10px] opacity-80">
                {message.metrics?.ttftMs && (
                  <span className="inline-flex items-center gap-1">
                    <Zap className="h-3 w-3 text-amber-400" />
                    {message.metrics.ttftMs}ms
                  </span>
                )}
                {message.metrics?.tokensPerSec && <span>{message.metrics.tokensPerSec} tok/s</span>}
                {message.usage?.totalTokenCount && (
                  <span>
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
