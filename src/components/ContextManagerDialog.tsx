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
  StudioModalBody,
  StudioModalFooter,
  StudioModalHeader,
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
      <DialogContent className="max-w-xl">
        {open && (
          <>
            <StudioModalHeader
              icon={<Cpu className="h-[18px] w-[18px]" />}
              title="Context Window Manager"
              badge={
                <span className="rounded-full border border-border/80 bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Sesi Ini
                </span>
              }
              description="Optimalkan ukuran token tanpa menghapus riwayat visual & Canvas di layar."
            />

            <StudioModalBody className="space-y-4">
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
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Konteks Aktif Terkirim
                    </div>
                    <div className="font-mono text-xl font-bold tabular-nums tracking-tight text-foreground">
                      {stats.effectiveTokens.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-muted-foreground">tokens</span>
                    </div>
                  </div>
                  {stats.rawTokens > stats.effectiveTokens && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                      -{Math.round(((stats.rawTokens - stats.effectiveTokens) / stats.rawTokens) * 100)}% lebih hemat
                    </span>
                  )}
                </div>
                <div className="mt-2.5 space-y-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-background/80 ring-1 ring-border/60">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-300',
                        isOverFreeLimit ? 'bg-amber-400' : 'bg-emerald-400'
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(2, Math.round((stats.effectiveTokens / 250_000) * 100)))}%`,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      Mentah: <strong className="text-foreground/90">{stats.rawTokens.toLocaleString()}</strong> • Dedup:{' '}
                      <strong className="text-foreground/90">{stats.dedupedTokens.toLocaleString()}</strong>
                    </span>
                    <span className="font-mono text-[10px]">
                      {Math.min(100, Math.round((stats.effectiveTokens / 250_000) * 100))}% / 250k TPM
                    </span>
                  </div>
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
            </StudioModalBody>

            <StudioModalFooter className="sm:justify-between">
              {conversation.compactedContext ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSummarizing}
                  onClick={handleResetRaw}
                  className="h-9 w-full justify-center gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground sm:w-auto sm:justify-start"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Kembalikan Utuh</span>
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="h-9 w-full rounded-xl px-5 sm:w-auto"
              >
                Tutup
              </Button>
            </StudioModalFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
