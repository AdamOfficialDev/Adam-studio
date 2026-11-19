import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileJson,
  FileText,
  FileUp,
  Layers,
  MessageSquarePlus,
  Scissors,
  Sparkles,
} from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { StudioScroll } from '@/components/ui/studio-scroll';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { condenseLongCodeBlocks, parseImportedChatContent } from '@/lib/importer';
import { cn, estimateTokens } from '@/lib/utils';
import type { ChatMessage } from '@/types/chat';

interface ImportChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasActiveSession: boolean;
  activeSessionTitle?: string;
  defaultModel: string;
  onConfirmImport: (payload: {
    mode: 'new' | 'append';
    title: string;
    model: string;
    sessionSystemInstruction?: string;
    sourceLabel?: string;
    messages: ChatMessage[];
  }) => void;
}

export function ImportChatDialog({
  open,
  onOpenChange,
  hasActiveSession,
  activeSessionTitle,
  defaultModel,
  onConfirmImport,
}: ImportChatDialogProps) {
  const [rawInput, setRawInput] = useState('');
  const [fileName, setFileName] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [mode, setMode] = useState<'new' | 'append'>('new');
  const [condenseCode, setCondenseCode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => {
    if (!rawInput.trim()) return null;
    return parseImportedChatContent(rawInput, fileName || 'Imported Context');
  }, [rawInput, fileName]);

  const finalMessages = useMemo(() => {
    if (!parsed?.ok) return [];
    if (!condenseCode) return parsed.messages;
    return parsed.messages.map((m) => ({
      ...m,
      content: condenseLongCodeBlocks(m.content, 80),
    }));
  }, [parsed, condenseCode]);

  const finalTokens = useMemo(() => {
    return finalMessages.reduce(
      (sum, m) => sum + estimateTokens(m.content) + estimateTokens(m.thought || ''),
      0
    );
  }, [finalMessages]);

  const handleReadFile = async (file: File) => {
    const text = await file.text();
    setFileName(file.name);
    setRawInput(text);
    const check = parseImportedChatContent(text, file.name);
    if (check.ok && check.title) {
      setCustomTitle(check.title);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleReadFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleReadFile(file);
  };

  const resetForm = () => {
    setRawInput('');
    setFileName('');
    setCustomTitle('');
    setCondenseCode(false);
    setMode('new');
  };

  const handleConfirm = () => {
    if (!parsed?.ok || finalMessages.length === 0) return;

    onConfirmImport({
      mode: hasActiveSession ? mode : 'new',
      title: (customTitle || parsed.title || 'Imported Chat').trim(),
      model: parsed.model || defaultModel,
      sessionSystemInstruction: parsed.sessionSystemInstruction,
      sourceLabel: parsed.sourceLabel,
      messages: finalMessages,
    });
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b bg-card/60 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <FileUp className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Import Konteks Chat (.json / .md)</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Impor history dari Google AI Studio (Drive JSON), Adam Studio, atau Markdown khusus
                untuk sesi ini saja.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <StudioScroll className="min-h-0 flex-1" autoHide="scroll">
          <div className="space-y-4 p-4 sm:p-6">
            {/* Upload / Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-5 text-center transition-colors',
                isDragging
                  ? 'border-primary bg-primary/10'
                  : 'border-border/80 bg-muted/20 hover:bg-muted/35'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.md,.txt,application/json,text/markdown,text/plain"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="flex items-center gap-2 text-primary">
                <FileJson className="h-5 w-5" />
                <FileText className="h-5 w-5" />
              </div>
              <div className="text-xs font-medium text-foreground">
                {fileName ? `File dimuat: ${fileName}` : 'Tarik file .json / .md dari Google Drive atau komputer ke sini'}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 h-8 rounded-xl text-xs"
              >
                Pilih File (.json / .md)
              </Button>
            </div>

            {/* Paste Area */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  Atau paste isi JSON / Markdown langsung:
                </span>
                {rawInput && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-[11px] text-muted-foreground underline hover:text-foreground"
                  >
                    Bersihkan
                  </button>
                )}
              </div>
              <div className="rounded-xl border bg-background/80 p-1 focus-within:ring-2 focus-within:ring-ring">
                <StudioScroll className="max-h-[140px] w-full" autoHide="scroll">
                  <Textarea
                    rows={4}
                    value={rawInput}
                    onChange={(e) => setRawInput(e.target.value)}
                    placeholder='Paste JSON dari Google AI Studio (chunkedPrompt), Adam Studio Export, atau Markdown (### User ... ### Assistant)...'
                    className="min-h-[90px] resize-none border-0 bg-transparent px-2.5 py-2 font-mono text-xs shadow-none focus-visible:ring-0"
                  />
                </StudioScroll>
              </div>
            </div>

            {/* Parse Result Preview */}
            {parsed && !parsed.ok && (
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{parsed.error}</span>
              </div>
            )}

            {parsed?.ok && (
              <div className="space-y-3.5 rounded-2xl border bg-card/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <Badge variant="secondary" className="text-[11px]">
                      {parsed.sourceLabel}
                    </Badge>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {finalMessages.length} pesan • ~{finalTokens.toLocaleString()} tokens
                  </div>
                </div>

                {hasActiveSession && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setMode('new')}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border p-2.5 text-left text-xs transition-colors',
                        mode === 'new'
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'bg-background/50 hover:bg-accent'
                      )}
                    >
                      <MessageSquarePlus className="h-4 w-4 shrink-0" />
                      <div>
                        <div>Buat Sesi Baru</div>
                        <div className="text-[10px] text-muted-foreground">
                          Sesi baru khusus konteks ini
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMode('append')}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border p-2.5 text-left text-xs transition-colors',
                        mode === 'append'
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'bg-background/50 hover:bg-accent'
                      )}
                    >
                      <Layers className="h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div>Gabung ke Sesi Ini</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {activeSessionTitle || 'Sesi aktif'}
                        </div>
                      </div>
                    </button>
                  </div>
                )}

                {(!hasActiveSession || mode === 'new') && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Judul Sesi
                    </label>
                    <Input
                      value={customTitle || parsed.title || ''}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="Judul sesi chat..."
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/50 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Scissors className="h-3.5 w-3.5 text-primary" />
                    <div>
                      <div className="font-medium">Ringkas blok kode lama (&gt;80 baris)</div>
                      <div className="text-[10px] text-muted-foreground">
                        Hemat token untuk mencegah limit 503/429 jika file dari Drive sangat besar.
                      </div>
                    </div>
                  </div>
                  <Switch checked={condenseCode} onCheckedChange={setCondenseCode} />
                </div>

                {/* Mini Turn Preview */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Preview Isi Terdeteksi
                  </div>
                  <StudioScroll className="max-h-[140px] rounded-xl border bg-background/60 p-2.5">
                    <div className="space-y-2 text-[11px]">
                      {finalMessages.slice(0, 6).map((m, idx) => (
                        <div key={m.id} className="flex gap-2">
                          <span
                            className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase',
                              m.role === 'user'
                                ? 'bg-secondary text-secondary-foreground'
                                : 'bg-primary/15 text-primary'
                            )}
                          >
                            {idx + 1}. {m.role === 'user' ? 'User' : 'AI'}
                          </span>
                          <span className="line-clamp-2 text-muted-foreground">{m.content}</span>
                        </div>
                      ))}
                      {finalMessages.length > 6 && (
                        <div className="pt-1 text-center text-[10px] text-muted-foreground">
                          ... dan {finalMessages.length - 6} pesan lainnya
                        </div>
                      )}
                    </div>
                  </StudioScroll>
                </div>
              </div>
            )}
          </div>
        </StudioScroll>

        <DialogFooter className="shrink-0 border-t bg-card/80 px-4 py-3 sm:px-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="rounded-xl px-4"
          >
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!parsed?.ok || finalMessages.length === 0}
            onClick={handleConfirm}
            className="gap-1.5 rounded-xl px-4"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {hasActiveSession && mode === 'append'
                ? 'Gabungkan ke Sesi Ini'
                : 'Lanjutkan di Sesi Baru'}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
