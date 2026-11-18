import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Brain,
  Crosshair,
  FileCode2,
  ImagePlus,
  Mic,
  MicOff,
  Slash,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { StudioScroll, type StudioScrollHandle } from '@/components/ui/studio-scroll';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PERSONA_PRESETS, SLASH_PROMPTS } from '@/lib/personas';
import { estimateTokens, formatBytes, generateId } from '@/lib/utils';
import type { AppSettings, Attachment, VisualTarget } from '@/types/chat';
import { cn } from '@/lib/utils';

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultItem>>;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface ChatComposerProps {
  model: string;
  isStreaming: boolean;
  settings: AppSettings;
  externalDraft?: string | null;
  visualTarget?: VisualTarget | null;
  onClearVisualTarget?: () => void;
  onClearExternalDraft?: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onPreviewImage: (url: string) => void;
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'py',
  'css',
  'html',
  'sql',
  'yaml',
  'yml',
  'sh',
]);

const THINKING_BUDGET_OPTIONS = [
  { label: 'Auto', value: -1 },
  { label: '1K', value: 1024 },
  { label: '4K', value: 4096 },
  { label: '8K', value: 8192 },
  { label: '16K', value: 16384 },
];

export function ChatComposer({
  model,
  isStreaming,
  settings,
  externalDraft,
  visualTarget,
  onClearVisualTarget,
  onClearExternalDraft,
  onUpdateSettings,
  onSend,
  onStop,
  onPreviewImage,
}: ChatComposerProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputScrollRef = useRef<StudioScrollHandle | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;

    const vp = inputScrollRef.current?.getViewport();
    if (vp && el.selectionStart === el.value.length) {
      vp.scrollTop = vp.scrollHeight;
    }
  };

  useEffect(() => {
    if (externalDraft) {
      setInput(externalDraft);
      onClearExternalDraft?.();
      setTimeout(() => {
        textareaRef.current?.focus();
        adjustHeight();
      }, 20);
    }
  }, [externalDraft, onClearExternalDraft]);

  useEffect(() => {
    if (visualTarget) {
      setTimeout(() => textareaRef.current?.focus(), 30);
    }
  }, [visualTarget]);

  const speechSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  const slashSuggestions = useMemo(() => {
    if (!input.startsWith('/') || input.includes('\n')) return [];
    const cmd = input.split(/\s/)[0].toLowerCase();
    return SLASH_PROMPTS.filter(
      (p) => p.command.startsWith(cmd) || p.title.toLowerCase().includes(cmd.slice(1))
    );
  }, [input]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashSuggestions.length]);

  const ingestFiles = async (files: File[]) => {
    const loaded: Attachment[] = [];
    for (const file of files.slice(0, 5)) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(',')[1] || '';
        if (!base64) continue;
        loaded.push({
          id: generateId(),
          kind: 'image',
          name: file.name,
          mimeType: file.type,
          size: file.size,
          data: base64,
          previewUrl: dataUrl,
        });
      } else {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
          const textContent = await file.text();
          loaded.push({
            id: generateId(),
            kind: 'text',
            name: file.name,
            mimeType: file.type || 'text/plain',
            size: file.size,
            textContent: textContent.slice(0, 60000),
          });
        }
      }
    }
    if (loaded.length > 0) {
      setAttachments((prev) => [...prev, ...loaded]);
      toast.success(`${loaded.length} lampiran ditambahkan`);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) await ingestFiles(files);
    e.target.value = '';
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length > 0) {
      e.preventDefault();
      await ingestFiles(files);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) await ingestFiles(files);
  };

  const toggleVoiceInput = () => {
    if (!speechSupported) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = 'id-ID';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((res) => res[0]?.transcript || '')
        .join(' ')
        .trim();
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setTimeout(adjustHeight, 10);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const handleEnhancePrompt = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const enhanced = [
      `Tolong kerjakan permintaan berikut secara terstruktur dan menyeluruh:`,
      ``,
      `**Tujuan Utama:** ${trimmed}`,
      ``,
      `**Kriteria Output:**`,
      `- Berikan analisis arsitektur / langkah jelas`,
      `- Sertakan contoh implementasi lengkap & siap jalan`,
      `- Jelaskan edge-case dan optimasi performa`,
    ].join('\n');
    setInput(enhanced);
    setTimeout(adjustHeight, 10);
    toast.success('Prompt diperkaya');
  };

  const applySlashTemplate = (template: string) => {
    setInput(template);
    setTimeout(() => {
      textareaRef.current?.focus();
      adjustHeight();
    }, 10);
  };

  const submit = () => {
    if (isStreaming) return;
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;

    onSend(trimmed, attachments);
    setInput('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const chosen = slashSuggestions[slashIndex];
        if (chosen) applySlashTemplate(chosen.template);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const activePersona = PERSONA_PRESETS.find((p) => p.id === settings.activePersonaId);
  const draftTokens = estimateTokens(input);
  const thinkingOn = settings.includeThoughts && settings.thinkingBudget !== 0;

  return (
    <div
      className="relative mx-auto w-full max-w-3xl px-3 pb-3 pt-1.5 sm:px-4 sm:pb-4"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {slashSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            className="mb-2 overflow-hidden rounded-2xl border bg-popover/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Slash Prompt Templates</span>
              <span className="hidden sm:inline">↑↓ pilih • Enter sisipkan</span>
            </div>
            <StudioScroll className="max-h-[210px]" autoHide="scroll">
              <div className="space-y-0.5">
                {slashSuggestions.map((item, idx) => (
                  <button
                    key={item.command}
                    type="button"
                    onClick={() => applySlashTemplate(item.template)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition-colors',
                      idx === slashIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">
                        <span className="font-semibold text-foreground">{item.title}</span>
                        <span className="ml-2 hidden text-muted-foreground sm:inline">
                          {item.description}
                        </span>
                      </span>
                    </span>
                    <code className="ml-2 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      {item.command}
                    </code>
                  </button>
                ))}
              </div>
            </StudioScroll>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'rounded-2xl border border-border/90 bg-card/95 p-2.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] transition-all focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 sm:p-3',
          isDragging && 'border-primary ring-2 ring-primary/30'
        )}
      >
        {isDragging && (
          <div className="mb-2 rounded-xl border border-dashed border-primary bg-primary/10 py-3 text-center text-xs font-medium text-primary">
            Lepaskan gambar atau file kode (.ts, .py, .json, .md) di sini
          </div>
        )}

        {visualTarget && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <Crosshair className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate font-mono text-[11px] font-semibold text-primary">
                &lt;{visualTarget.selector}&gt;
              </span>
              {visualTarget.textSnippet && (
                <span className="hidden truncate text-muted-foreground sm:inline">
                  &ldquo;{visualTarget.textSnippet}&rdquo;
                </span>
              )}
            </div>
            {onClearVisualTarget && (
              <button
                type="button"
                onClick={onClearVisualTarget}
                className="rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label="Hapus target elemen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2 px-1">
            {attachments.map((att) =>
              att.kind === 'image' && att.previewUrl ? (
                <div key={att.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onPreviewImage(att.previewUrl!)}
                    className="overflow-hidden rounded-xl border"
                  >
                    <img
                      src={att.previewUrl}
                      alt={att.name}
                      className="h-14 w-14 object-cover transition-transform hover:scale-105 sm:h-16 sm:w-16"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                    }
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 shadow ring-1 ring-border hover:bg-destructive hover:text-destructive-foreground"
                    aria-label="Hapus lampiran"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div
                  key={att.id}
                  className="flex items-center gap-2 rounded-xl border bg-muted/60 px-2.5 py-1.5 text-xs"
                >
                  <FileCode2 className="h-3.5 w-3.5 text-primary" />
                  <span className="max-w-[120px] truncate font-mono">{att.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatBytes(att.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                    }
                    className="rounded p-0.5 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <StudioScroll ref={inputScrollRef} className="max-h-[185px] w-full" autoHide="scroll">
          <Textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              visualTarget
                ? `Instruksi edit untuk <${visualTarget.selector}>...`
                : `Tanya ${model}...`
            }
            className="min-h-[42px] w-full resize-none overflow-hidden border-0 bg-transparent px-2 py-2 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </StudioScroll>

        <div className="mt-1.5 flex items-center justify-between gap-1.5 border-t border-border/40 pt-2">
          <div className="flex flex-wrap items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.ts,.tsx,.js,.jsx,.json,.py,.css,.html,.sql"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground sm:w-auto sm:px-2.5"
              title="Upload Gambar atau File Kode"
            >
              <ImagePlus className="h-4 w-4" />
              <span className="hidden text-xs sm:inline">Lampiran</span>
            </Button>

            <Button
              type="button"
              variant={thinkingOn ? 'secondary' : 'ghost'}
              size="sm"
              disabled={isStreaming}
              onClick={() => {
                const next = !thinkingOn;
                onUpdateSettings({
                  ...settings,
                  includeThoughts: next,
                  thinkingBudget: next && settings.thinkingBudget === 0 ? -1 : settings.thinkingBudget,
                });
                toast.success(next ? 'Thinking Process: Aktif' : 'Thinking Process: Nonaktif');
              }}
              className={cn(
                'h-8 gap-1 rounded-xl px-2 text-xs',
                thinkingOn
                  ? 'border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Tampilkan proses thinking AI (ala Google AI Studio)"
            >
              <Brain className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Think</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setInput('/');
                textareaRef.current?.focus();
              }}
              disabled={isStreaming}
              className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground"
              title="Slash Templates (/)"
            >
              <Slash className="h-3.5 w-3.5" />
            </Button>

            {input.trim().length > 4 && !isStreaming && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleEnhancePrompt}
                className="h-8 gap-1 rounded-xl px-2 text-xs text-primary hover:bg-primary/10"
                title="Perkaya struktur prompt"
              >
                <Wand2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Enhance</span>
              </Button>
            )}

            {speechSupported && (
              <Button
                type="button"
                variant={isListening ? 'destructive' : 'ghost'}
                size="icon"
                onClick={toggleVoiceInput}
                disabled={isStreaming}
                className="h-8 w-8 rounded-xl"
                title={isListening ? 'Hentikan Voice Input' : 'Voice Input'}
              >
                {isListening ? (
                  <MicOff className="h-4 w-4 animate-pulse" />
                ) : (
                  <Mic className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
                  title="Quick Tuning"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span className="hidden max-w-[95px] truncate sm:inline">
                    {activePersona?.name || 'Tuning'}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[calc(100vw-2rem)] max-w-xs space-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold">Quick Persona</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PERSONA_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            ...settings,
                            activePersonaId: p.id,
                            systemInstruction: p.systemInstruction,
                            temperature: p.temperature,
                          })
                        }
                        className={cn(
                          'rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                          settings.activePersonaId === p.id
                            ? 'border-primary bg-primary/10 font-medium text-primary'
                            : 'hover:bg-accent'
                        )}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Brain className="h-3.5 w-3.5 text-primary" />
                      Thinking Budget
                    </span>
                    <Switch
                      checked={thinkingOn}
                      onCheckedChange={(checked) =>
                        onUpdateSettings({
                          ...settings,
                          includeThoughts: checked,
                          thinkingBudget: checked && settings.thinkingBudget === 0 ? -1 : settings.thinkingBudget,
                        })
                      }
                    />
                  </div>
                  {thinkingOn && (
                    <div className="grid grid-cols-5 gap-1">
                      {THINKING_BUDGET_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              includeThoughts: true,
                              thinkingBudget: opt.value,
                            })
                          }
                          className={cn(
                            'rounded-md border py-1 font-mono text-[10px] transition-colors',
                            settings.thinkingBudget === opt.value
                              ? 'border-primary bg-primary/15 font-semibold text-primary'
                              : 'hover:bg-accent'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">Temperature</span>
                    <span className="font-mono text-primary">{settings.temperature.toFixed(1)}</span>
                  </div>
                  <Slider
                    min={0}
                    max={2}
                    step={0.1}
                    value={[settings.temperature]}
                    onValueChange={([val]) => onUpdateSettings({ ...settings, temperature: val })}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                  <span className="text-xs font-medium">Demo SSE Mode</span>
                  <Switch
                    checked={settings.demoMode}
                    onCheckedChange={(checked) =>
                      onUpdateSettings({ ...settings, demoMode: checked })
                    }
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-2">
            {draftTokens > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">~{draftTokens} tok</span>
            )}

            {isStreaming ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={onStop}
                className="h-8 gap-1.5 rounded-xl px-3"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop</span>
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                onClick={submit}
                disabled={!input.trim() && attachments.length === 0}
                className="h-8 w-8 rounded-xl shadow-md"
                aria-label="Kirim pesan"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground sm:text-[11px]">
        <span className="inline-flex items-center gap-1 truncate">
          <Sparkles className="h-3 w-3 shrink-0 text-primary" />
          <span className="truncate font-mono">{model}</span>
        </span>
        <span className="hidden sm:inline">Ctrl+K Palette • Ctrl+\ Zen Mode</span>
        <span className="sm:hidden">Ketik / untuk template</span>
      </div>
    </div>
  );
}
