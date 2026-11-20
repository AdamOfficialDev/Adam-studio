import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Cpu,
  Loader2,
  RotateCcw,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  applyKeepLatestCodeToMessages,
  buildEffectiveApiHistory,
  estimateMessagesTokenTotal,
  runLosslessContextCompaction,
} from '@/lib/importer';
import type { CompactedContextState, Conversation } from '@/types/chat';
import { cn, estimateTokens } from '@/lib/utils';

interface ContextManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation | null;
  apiKey: string;
  hasApiKey: boolean;
  onApplyCompaction: (convId: string, compacted?: CompactedContextState) => void;
}

export function ContextManagerDialog({
  open,
  onOpenChange,
  conversation,
  apiKey,
  hasApiKey,
  onApplyCompaction,
}: ContextManagerDialogProps) {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [keepRecentCount, setKeepRecentCount] = useState(6);

  const stats = useMemo(() => {
    if (!open || !conversation) return null;
    const rawTokens = estimateMessagesTokenTotal(conversation.messages);
    const dedupedMessages = applyKeepLatestCodeToMessages(conversation.messages, 2);
    const dedupedTokens = estimateMessagesTokenTotal(dedupedMessages);
    const activeApiHistory = buildEffectiveApiHistory(
      conversation.messages,
      conversation.compactedContext
    );
    const effectiveTokens = estimateMessagesTokenTotal(activeApiHistory);
    return { rawTokens, dedupedTokens, effectiveTokens };
  }, [open, conversation]);

  if (!conversation || !stats) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg" />
      </Dialog>
    );
  }

  const handleApplyKeepLatestCode = () => {
    onApplyCompaction(conversation.id, {
      mode: 'keep-latest-code',
      keepRecentCount: conversation.messages.length,
      estimatedTokens: stats.dedupedTokens,
      updatedAt: Date.now(),
    });
    toast.success(
      `Konteks API dioptimalkan: ${stats.rawTokens.toLocaleString()} → ${stats.dedupedTokens.toLocaleString()} tok!`
    );
    onOpenChange(false);
  };

  const handleRunAiSummarize = async () => {
    if (!hasApiKey) {
      toast.error('Masukkan API Key di Settings terlebih dahulu.');
      return;
    }
    setIsSummarizing(true);
    setStatusMsg('Memecah riwayat chat menjadi chunk aman (<110k tok)...');

    const result = await runLosslessContextCompaction({
      messages: conversation.messages,
      keepRecentCount,
      model: conversation.model,
      apiKey,
      onStatus: setStatusMsg,
    });

    setIsSummarizing(false);
    setStatusMsg('');

    if (!result.ok || !result.summary) {
      toast.error(result.error || 'Gagal meringkas konteks');
      return;
    }

    const recentSlice = applyKeepLatestCodeToMessages(
      conversation.messages.slice(-keepRecentCount),
      2
    );
    const finalTokens =
      estimateTokens(result.summary) + estimateMessagesTokenTotal(recentSlice) + 80;

    onApplyCompaction(conversation.id, {
      mode: 'ai-summary',
      summaryPrefix: result.summary,
      keepRecentCount,
      estimatedTokens: finalTokens,
      updatedAt: Date.now(),
    });

    toast.success(
      `AI Lossless Compaction selesai! Konteks turun jadi ~${finalTokens.toLocaleString()} tokens.`
    );
    onOpenChange(false);
  };

  const handleResetRaw = () => {
    onApplyCompaction(conversation.id, undefined);
    toast.success('Konteks dikembalikan ke riwayat mentah penuh');
    onOpenChange(false);
  };

  const isOverFreeLimit = stats.effectiveTokens > 235_000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-xl flex-col gap-0 overflow-hidden p-0">
        {open && (
          <>
            <DialogHeader className="shrink-0 border-b bg-card/60 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <DialogTitle>Context Window Manager (Sesi Ini)</DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs">
                    Optimalkan ukuran token tanpa menghapus riwayat visual & Canvas di layar.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 overscroll-contain sm:p-6">
              {/* Token Status Card */}
              <div
                className={cn(
                  'rounded-2xl border p-4',
                  isOverFreeLimit
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-emerald-500/35 bg-emerald-500/[0.07]'
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    {isOverFreeLimit ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    )}
                    <span>
                      {isOverFreeLimit
                        ? 'Melebihi Batas Free Tier (250.000 TPM)'
                        : 'Aman untuk Free Tier (< 250.000 TPM)'}
                    </span>
                  </div>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {stats.effectiveTokens.toLocaleString()} API tok
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>Asli mentah: {stats.rawTokens.toLocaleString()} tok</span>
                  <span>•</span>
                  <span>
                    Tanpa kode duplikat lama: {stats.dedupedTokens.toLocaleString()} tok
                  </span>
                </div>
              </div>

              {/* Opsi 1: Instant Zero-Loss Code Dedup */}
              <div className="space-y-3 rounded-2xl border bg-card/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Scissors className="h-4 w-4 text-primary" />
                      Opsi 1: Pertahankan 2 Kode Terbaru Saja (0ms)
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      <strong>100% tanpa kehilangan teks percakapan.</strong> Semua prompt & jawaban
                      tetap dikirim utuh; hanya duplikat kode lama (misal <code>v1–v36</code>) yang
                      diganti penanda singkat sementara <strong>2 kode terbaru tetap utuh</strong>.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-border/50 pt-3">
                  <span className="font-mono text-xs text-primary">
                    Estimasi hasil: ~{stats.dedupedTokens.toLocaleString()} tok
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isSummarizing}
                    onClick={handleApplyKeepLatestCode}
                    className="rounded-xl text-xs"
                  >
                    Terapkan Sekarang
                  </Button>
                </div>
              </div>

              {/* Opsi 2: AI Lossless Chunked Summarizer */}
              <div className="space-y-3 rounded-2xl border bg-card/70 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Brain className="h-4 w-4 text-primary" />
                    Opsi 2: AI Lossless Deep Summarize
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Jika teks saja masih &gt;200k token, AI akan merangkum giliran lama per bagian
                    (&lt;110k tok) memakai pool key kamu—mempertahankan semua aturan UI/UX, bug,
                    file path, & keputusan—lalu menjaga pesan terakhir tetap utuh verbatim.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Pertahankan pesan terakhir utuh:</span>
                  <div className="flex gap-1">
                    {[4, 6, 10].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setKeepRecentCount(n)}
                        className={cn(
                          'rounded-lg border px-2.5 py-1 font-mono text-[11px]',
                          keepRecentCount === n
                            ? 'border-primary bg-primary/15 font-semibold text-primary'
                            : 'hover:bg-accent'
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {statusMsg && (
                  <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span>{statusMsg}</span>
                  </div>
                )}

                <div className="flex justify-end border-t border-border/50 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSummarizing || conversation.messages.length <= keepRecentCount}
                    onClick={() => void handleRunAiSummarize()}
                    className="gap-1.5 rounded-xl text-xs"
                  >
                    {isSummarizing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Meringkas...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Jalankan AI Lossless Summarize</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="shrink-0 justify-between border-t bg-card/80 px-4 py-3 sm:px-6">
              {conversation.compactedContext ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSummarizing}
                  onClick={handleResetRaw}
                  className="gap-1.5 text-xs text-muted-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Kembalikan Utuh
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="rounded-xl px-4"
              >
                Tutup
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
