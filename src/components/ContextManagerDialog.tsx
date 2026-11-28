import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Brain,
  CheckCircle2,
  Cpu,
  History,
  Layers,
  Loader2,
  RotateCcw,
  Scissors,
  Search,
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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  applyKeepLatestCodeToMessages,
  buildEffectiveApiHistory,
  estimateMessagesTokenTotal,
  resolveEffectiveContextConfig,
  runLosslessContextCompaction,
} from '@/lib/importer';
import type {
  AppSettings,
  CompactedContextState,
  ContextMode,
  Conversation,
  ConversationContextConfig,
} from '@/types/chat';
import { cn, estimateTokens } from '@/lib/utils';

interface ContextManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation | null;
  settings: AppSettings;
  apiKey: string;
  hasApiKey: boolean;
  onApplyCompaction: (convId: string, compacted?: CompactedContextState) => void;
  onUpdateContextConfig: (convId: string, config?: ConversationContextConfig) => void;
}

const RECENT_PRESETS = [4, 10, 15, 25, 50];

export function ContextManagerDialog({
  open,
  onOpenChange,
  conversation,
  settings,
  apiKey,
  hasApiKey,
  onApplyCompaction,
  onUpdateContextConfig,
}: ContextManagerDialogProps) {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [keepRecentCount, setKeepRecentCount] = useState(15);
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');

  const resolvedConfig = useMemo(
    () => resolveEffectiveContextConfig(settings, conversation),
    [settings, conversation]
  );

  useEffect(() => {
    if (!open || !conversation) return;
    setKeepRecentCount(resolvedConfig.recentMessages);
    setMemoryDraft(conversation.compactedContext?.summaryPrefix || '');
    setEditingMemory(false);
  }, [open, conversation, resolvedConfig.recentMessages]);

  const stats = useMemo(() => {
    if (!open || !conversation) return null;
    const rawTokens = estimateMessagesTokenTotal(conversation.messages);
    const dedupedMessages = applyKeepLatestCodeToMessages(
      conversation.messages,
      resolvedConfig.keepCodeBlocks
    );
    const dedupedTokens = estimateMessagesTokenTotal(dedupedMessages);
    const activeApiHistory = buildEffectiveApiHistory(
      conversation.messages,
      conversation.compactedContext,
      { contextConfig: resolvedConfig }
    );
    const effectiveTokens = estimateMessagesTokenTotal(activeApiHistory);
    const totalMessages = conversation.messages.length;
    const windowStart = Math.max(0, totalMessages - resolvedConfig.recentMessages);
    const archivedCount = Math.min(conversation.compactedContext?.archivedCount ?? 0, totalMessages);
    const unarchivedOutsideWindow = Math.max(0, windowStart - archivedCount);
    return {
      rawTokens,
      dedupedTokens,
      effectiveTokens,
      totalMessages,
      windowStart,
      archivedCount,
      unarchivedOutsideWindow,
      sentMessagesCount: activeApiHistory.length,
    };
  }, [open, conversation, resolvedConfig]);

  if (!conversation || !stats) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg" />
      </Dialog>
    );
  }

  const hasCustomOverride = Boolean(
    conversation.contextConfig && Object.keys(conversation.contextConfig).length > 0
  );

  const patchSessionConfig = (patch: Partial<ConversationContextConfig>) => {
    onUpdateContextConfig(conversation.id, {
      ...(conversation.contextConfig || {}),
      ...patch,
    });
  };

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

  const handleRunRollingArchiveNow = async () => {
    if (!hasApiKey) {
      toast.error('Masukkan API Key di Settings terlebih dahulu.');
      return;
    }
    const targetEnd = Math.max(0, conversation.messages.length - resolvedConfig.recentMessages);
    if (targetEnd <= 0) {
      toast.info('Semua pesan masih berada dalam jendela aktif terbaru.');
      return;
    }
    const startIdx = Math.min(conversation.compactedContext?.archivedCount ?? 0, targetEnd);
    const messagesToCompact =
      startIdx < targetEnd
        ? conversation.messages.slice(startIdx, targetEnd)
        : conversation.messages.slice(0, targetEnd);

    setIsSummarizing(true);
    setStatusMsg(`Meringkas pesan #${startIdx + 1}–#${targetEnd} ke Rolling Memory...`);

    const result = await runLosslessContextCompaction({
      messages: conversation.messages,
      keepRecentCount: resolvedConfig.recentMessages,
      messagesToCompact,
      model: conversation.model,
      apiKey,
      existingSummary:
        startIdx > 0 && startIdx < targetEnd
          ? conversation.compactedContext?.summaryPrefix
          : undefined,
      onStatus: setStatusMsg,
    });

    setIsSummarizing(false);
    setStatusMsg('');

    if (!result.ok || !result.summary) {
      toast.error(result.error || 'Gagal memperbarui Rolling Memory');
      return;
    }

    const recentSlice = applyKeepLatestCodeToMessages(
      conversation.messages.slice(-resolvedConfig.recentMessages),
      resolvedConfig.keepCodeBlocks
    );
    const finalTokens =
      estimateTokens(result.summary) + estimateMessagesTokenTotal(recentSlice) + 80;

    onApplyCompaction(conversation.id, {
      mode: 'ai-summary',
      summaryPrefix: result.summary,
      keepRecentCount: resolvedConfig.recentMessages,
      archivedCount: targetEnd,
      estimatedTokens: finalTokens,
      updatedAt: Date.now(),
    });
    setMemoryDraft(result.summary);
    toast.success(
      `Rolling Memory diperbarui! Pesan #1–#${targetEnd} terarsip, aktif ~${finalTokens.toLocaleString()} tok.`
    );
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

    const archivedCount = Math.max(0, conversation.messages.length - keepRecentCount);
    const recentSlice = applyKeepLatestCodeToMessages(
      conversation.messages.slice(-keepRecentCount),
      resolvedConfig.keepCodeBlocks
    );
    const finalTokens =
      estimateTokens(result.summary) + estimateMessagesTokenTotal(recentSlice) + 80;

    onApplyCompaction(conversation.id, {
      mode: 'ai-summary',
      summaryPrefix: result.summary,
      keepRecentCount,
      archivedCount,
      estimatedTokens: finalTokens,
      updatedAt: Date.now(),
    });

    toast.success(
      `AI Lossless Compaction selesai! Konteks turun jadi ~${finalTokens.toLocaleString()} tokens.`
    );
    onOpenChange(false);
  };

  const handleSaveManualMemory = () => {
    const trimmed = memoryDraft.trim();
    if (!trimmed) {
      onApplyCompaction(conversation.id, undefined);
      setEditingMemory(false);
      toast.success('Memori inti dikosongkan');
      return;
    }
    onApplyCompaction(conversation.id, {
      mode: 'ai-summary',
      summaryPrefix: trimmed,
      keepRecentCount: resolvedConfig.recentMessages,
      archivedCount:
        conversation.compactedContext?.archivedCount ??
        Math.max(0, conversation.messages.length - resolvedConfig.recentMessages),
      estimatedTokens: estimateTokens(trimmed) + stats.effectiveTokens,
      updatedAt: Date.now(),
    });
    setEditingMemory(false);
    toast.success('Memori inti berhasil disimpan');
  };

  const handleResetRaw = () => {
    onApplyCompaction(conversation.id, undefined);
    setMemoryDraft('');
    toast.success('Memori & kompresi di-reset');
  };

  const isOverFreeLimit = stats.effectiveTokens > 235_000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {open && (
          <>
            <StudioModalHeader
              icon={<Cpu className="h-[18px] w-[18px]" />}
              title="Context & Rolling Memory"
              badge={
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                  {resolvedConfig.contextMode}
                </span>
              }
              description="Atur jumlah pesan terbaru yang dikirim ke API & kelola Memori Inti tanpa menghapus chat di layar."
            />

            <Tabs defaultValue="window" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-border/75 bg-card/85 px-4 py-2.5 sm:px-5">
                <TabsList className="grid h-9 w-full grid-cols-3 rounded-xl border border-border/75 bg-background/60 p-1">
                  <TabsTrigger value="window" className="gap-1.5 rounded-lg text-xs">
                    <Layers className="h-3.5 w-3.5" />
                    <span>Rolling Window</span>
                  </TabsTrigger>
                  <TabsTrigger value="ledger" className="gap-1.5 rounded-lg text-xs">
                    <Archive className="h-3.5 w-3.5" />
                    <span>Memori Inti</span>
                  </TabsTrigger>
                  <TabsTrigger value="tools" className="gap-1.5 rounded-lg text-xs">
                    <Scissors className="h-3.5 w-3.5" />
                    <span>Compactor</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <StudioModalBody className="space-y-4">
                {/* Token Status Card (selalu tampil di atas) */}
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
                        Terkirim per Request ({stats.sentMessagesCount} blok / {stats.totalMessages} total chat)
                      </div>
                      <div className="font-mono text-xl font-bold tabular-nums tracking-tight text-foreground">
                        {stats.effectiveTokens.toLocaleString()}{' '}
                        <span className="text-xs font-normal text-muted-foreground">tokens</span>
                      </div>
                    </div>
                    {stats.rawTokens > stats.effectiveTokens && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                        -
                        {Math.round(
                          ((stats.rawTokens - stats.effectiveTokens) / Math.max(1, stats.rawTokens)) *
                            100
                        )}
                        % hemat
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
                          width: `${Math.min(
                            100,
                            Math.max(2, Math.round((stats.effectiveTokens / 250_000) * 100))
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>
                        Total di IndexedDB:{' '}
                        <strong className="text-foreground/90">
                          {stats.rawTokens.toLocaleString()}
                        </strong>{' '}
                        • Terarsip:{' '}
                        <strong className="text-foreground/90">{stats.archivedCount}</strong> pesan
                      </span>
                      <span className="font-mono text-[10px]">
                        {Math.min(100, Math.round((stats.effectiveTokens / 250_000) * 100))}% / 250k
                        TPM
                      </span>
                    </div>
                  </div>
                </div>

                {/* TAB 1: ROLLING WINDOW & PER-SESSION OVERRIDE */}
                <TabsContent value="window" className="mt-0 space-y-4">
                  <div className="space-y-3 rounded-2xl border bg-card/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-foreground">
                          Mode Konteks Sesi Ini
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {hasCustomOverride
                            ? 'Menggunakan konfigurasi khusus untuk sesi ini.'
                            : `Mengikuti pengaturan global (${settings.contextMode}).`}
                        </p>
                      </div>
                      {hasCustomOverride && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onUpdateContextConfig(conversation.id, undefined)}
                          className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Ikuti Global
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'smart-rolling', label: 'Smart Rolling' },
                          { id: 'sliding-window', label: 'Sliding Only' },
                          { id: 'full', label: 'Full History' },
                        ] as Array<{ id: ContextMode; label: string }>
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => patchSessionConfig({ contextMode: opt.id })}
                          className={cn(
                            'rounded-xl border py-2 text-[11px] font-medium transition-colors',
                            resolvedConfig.contextMode === opt.id
                              ? 'border-primary bg-primary/15 font-semibold text-primary'
                              : 'bg-background/60 hover:bg-accent'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {resolvedConfig.contextMode !== 'full' && (
                    <>
                      <div className="space-y-3 rounded-2xl border bg-card/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              <History className="h-3.5 w-3.5 text-primary" />
                              <span>Jumlah Chat Terbaru yang Dikirim</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Masukkan angka berapa saja (1–500). Misalnya <strong>15</strong> untuk
                              mengirim 15 pesan terakhir saja.
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={1}
                              max={500}
                              value={resolvedConfig.recentMessages}
                              onChange={(e) => {
                                const raw = parseInt(e.target.value, 10);
                                patchSessionConfig({
                                  recentMessages: Number.isFinite(raw)
                                    ? Math.max(1, Math.min(500, raw))
                                    : 1,
                                });
                              }}
                              className="h-8 w-20 rounded-xl bg-background/80 text-center font-mono text-xs font-bold"
                            />
                            <span className="text-[11px] text-muted-foreground">pesan</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {RECENT_PRESETS.map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => patchSessionConfig({ recentMessages: n })}
                              className={cn(
                                'rounded-lg border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
                                resolvedConfig.recentMessages === n
                                  ? 'border-primary bg-primary/15 font-semibold text-primary'
                                  : 'bg-background/50 hover:bg-accent'
                              )}
                            >
                              {n} chat
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3 rounded-2xl border bg-card/70 p-4">
                        {resolvedConfig.contextMode === 'smart-rolling' && (
                          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-semibold">
                                <Brain className="h-3.5 w-3.5 text-primary" />
                                Auto-Summarize Pesan Lama
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Ringkas otomatis setiap {resolvedConfig.compactBatchSize} pesan
                                keluar dari window.
                              </p>
                            </div>
                            <Switch
                              checked={resolvedConfig.autoSummarize}
                              onCheckedChange={(checked) =>
                                patchSessionConfig({ autoSummarize: checked })
                              }
                            />
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-1.5 text-xs font-semibold">
                              <Search className="h-3.5 w-3.5 text-primary" />
                              Smart Keyword Recall
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Tarik otomatis pesan arsip yang cocok dengan kata kunci prompt terbaru.
                            </p>
                          </div>
                          <Switch
                            checked={resolvedConfig.smartRecall}
                            onCheckedChange={(checked) =>
                              patchSessionConfig({ smartRecall: checked })
                            }
                          />
                        </div>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* TAB 2: ROLLING MEMORY LEDGER */}
                <TabsContent value="ledger" className="mt-0 space-y-4">
                  <div className="space-y-3 rounded-2xl border bg-card/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-foreground">
                          Memori Inti Tersimpan (Rolling Summary)
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {stats.archivedCount > 0
                            ? `Mencakup pesan #1–#${stats.archivedCount}. ${
                                stats.unarchivedOutsideWindow > 0
                                  ? `Ada ${stats.unarchivedOutsideWindow} pesan di luar window yang belum diringkas.`
                                  : 'Semua pesan di luar window sudah terarsip.'
                              }`
                            : 'Belum ada memori terarsip untuk sesi ini.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isSummarizing || stats.windowStart <= 0}
                          onClick={() => void handleRunRollingArchiveNow()}
                          className="h-7 gap-1 rounded-lg px-2.5 text-[11px]"
                        >
                          {isSummarizing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3 text-primary" />
                          )}
                          <span>Arsipkan Sekarang</span>
                        </Button>
                      </div>
                    </div>

                    {statusMsg && (
                      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        <span>{statusMsg}</span>
                      </div>
                    )}

                    {editingMemory ? (
                      <div className="space-y-2">
                        <Textarea
                          rows={8}
                          value={memoryDraft}
                          onChange={(e) => setMemoryDraft(e.target.value)}
                          placeholder="Catatan memori inti sesi ini..."
                          className="rounded-xl bg-background/80 font-mono text-[11px] leading-relaxed"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingMemory(false);
                              setMemoryDraft(conversation.compactedContext?.summaryPrefix || '');
                            }}
                            className="h-8 rounded-xl text-xs"
                          >
                            Batal
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleSaveManualMemory}
                            className="h-8 rounded-xl text-xs"
                          >
                            Simpan Memori
                          </Button>
                        </div>
                      </div>
                    ) : conversation.compactedContext?.summaryPrefix ? (
                      <div className="space-y-2">
                        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                          {conversation.compactedContext.summaryPrefix}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingMemory(true)}
                            className="h-7 rounded-lg text-[11px] text-primary"
                          >
                            Edit Memori Manual
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/80 bg-background/40 p-4 text-center text-xs text-muted-foreground">
                        {stats.windowStart > 0
                          ? `Ada ${stats.windowStart} pesan di luar window (${resolvedConfig.recentMessages} terbaru). Klik "Arsipkan Sekarang" atau aktifkan Smart Rolling agar otomatis diringkas saat chat berjalan.`
                          : `Percakapan masih berisi ${stats.totalMessages} pesan (belum melewati batas window ${resolvedConfig.recentMessages} pesan).`}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* TAB 3: MANUAL COMPACTOR */}
                <TabsContent value="tools" className="mt-0 space-y-4">
                  {/* Opsi 1: Instant Zero-Loss Code Dedup */}
                  <div className="space-y-3 rounded-2xl border bg-card/70 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Scissors className="h-4 w-4 text-primary" />
                        Opsi 1: Pertahankan Kode Terbaru Saja (0ms)
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <strong>100% tanpa kehilangan teks percakapan.</strong> Hanya duplikat blok
                        kode lama yang diganti penanda singkat sementara{' '}
                        <strong>{resolvedConfig.keepCodeBlocks} kode terbaru tetap utuh</strong>.
                      </p>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/50 pt-3">
                      <span className="font-mono text-xs text-primary">
                        Estimasi dedup: ~{stats.dedupedTokens.toLocaleString()} tok
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
                        Merangkum seluruh pesan lama secara bertahap dan menjaga N pesan terakhir
                        tetap utuh verbatim.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Pertahankan pesan terakhir:</span>
                      <div className="flex items-center gap-1.5">
                        {[4, 10, 15, 25].map((n) => (
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
                </TabsContent>
              </StudioModalBody>
            </Tabs>

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
                  <span>Reset Memori</span>
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
