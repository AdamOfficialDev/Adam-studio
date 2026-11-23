import { memo, useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent, } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Brain,
  Globe,
  Link2,
  Check,
  Crosshair,
  FileAudio,
  FileCode2,
  FileText,
  FileVideo,
  Loader2,
  Mic,
  Paperclip,
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
import { StudioScroll, type StudioScrollHandle } from '@/components/ui/studio-scroll';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  THINKING_LEVEL_META,
  getModelThinkingCapabilities,
  resolveValidThinkingLevel,
} from '@/lib/models';
import { PERSONA_PRESETS, SLASH_PROMPTS } from '@/lib/personas';
import {
  WavAudioRecorder,
  normalizeTechTranscript,
  transcribeAudioWithAI,
} from '@/lib/speech';
import {
  estimateAttachmentTokensLocal,
  fetchExactAttachmentTokens,
  formatDuration,
} from '@/lib/tokens';
import { estimateTokens, formatBytes, generateId } from '@/lib/utils';
import type { AppSettings, Attachment, VisualTarget } from '@/types/chat';
import { cn } from '@/lib/utils';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
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
  hasApiKeyConfigured: boolean;
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
  'csv',
  'xml',
]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

const MAX_SAFE_ATTACHMENTS_CHARS = 3_600_000;
const MAX_SINGLE_BINARY_BYTES = 2_800_000;

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

async function compressImageForPayload(
  dataUrl: string,
  mimeType: string,
  originalSize: number
): Promise<{
  dataUrl: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
}> {
  const dims = await readImageDimensions(dataUrl);
  const rawBase64 = dataUrl.split(',')[1] || '';

  if (
    !dims.width ||
    !dims.height ||
    mimeType === 'image/svg+xml' ||
    (mimeType === 'image/gif' && originalSize <= 1_500_000)
  ) {
    return {
      dataUrl,
      base64: rawBase64,
      mimeType,
      width: dims.width,
      height: dims.height,
      size: originalSize,
    };
  }

  const maxSide = Math.max(dims.width, dims.height);
  if (maxSide <= 1600 && rawBase64.length <= 750_000) {
    return {
      dataUrl,
      base64: rawBase64,
      mimeType,
      width: dims.width,
      height: dims.height,
      size: originalSize,
    };
  }

  const encode = (limitPx: number, quality: number) =>
    new Promise<{ outUrl: string; w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, limitPx / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ outUrl: dataUrl, w: dims.width, h: dims.height });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        let outUrl = canvas.toDataURL('image/webp', quality);
        if (!outUrl.startsWith('data:image/webp')) {
          outUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve({ outUrl, w, h });
      };
      img.onerror = () => resolve({ outUrl: dataUrl, w: dims.width, h: dims.height });
      img.src = dataUrl;
    });

  let pass = await encode(1600, 0.84);
  let outBase64 = pass.outUrl.split(',')[1] || '';
  if (outBase64.length > 1_100_000) {
    pass = await encode(1280, 0.74);
    outBase64 = pass.outUrl.split(',')[1] || '';
  }

  if (outBase64 && outBase64.length < rawBase64.length) {
    const outMime = pass.outUrl.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';
    return {
      dataUrl: pass.outUrl,
      base64: outBase64,
      mimeType: outMime,
      width: pass.w,
      height: pass.h,
      size: Math.round((outBase64.length * 3) / 4),
    };
  }

  return {
    dataUrl,
    base64: rawBase64,
    mimeType,
    width: dims.width,
    height: dims.height,
    size: originalSize,
  };
}

function readMediaDuration(file: File, kind: 'video' | 'audio'): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const dur = Number.isFinite(el.duration) ? el.duration : undefined;
      URL.revokeObjectURL(url);
      resolve(dur);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    el.src = url;
  });
}

export const ChatComposer = memo(function ChatComposer({
  model,
  isStreaming,
  settings,
  hasApiKeyConfigured,
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

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState('');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [interimText, setInterimText] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputScrollRef = useRef<StudioScrollHandle | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wavRecorderRef = useRef<WavAudioRecorder | null>(null);

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

  useEffect(() => {
    if (!isRecording) {
      setRecordSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      wavRecorderRef.current?.cancel();
    };
  }, []);

  const browserSpeechSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  const aiAudioSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== 'undefined';

  const useAiStt =
    settings.sttMode === 'ai' && hasApiKeyConfigured && !settings.demoMode && aiAudioSupported;

  const micAvailable = useAiStt || browserSpeechSupported;

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

  const verifyExactTokensAsync = async (item: Attachment) => {
    if (settings.demoMode) return;
    if (item.size > 3_200_000 && item.kind !== 'text') return;

    setAttachments((prev) =>
      prev.map((a) => (a.id === item.id ? { ...a, countingTokens: true } : a))
    );

    const exactCount = await fetchExactAttachmentTokens({
      model,
      attachment: item,
      apiKey: settings.apiKey,
    });

    setAttachments((prev) =>
      prev.map((a) =>
        a.id !== item.id
          ? a
          : {
              ...a,
              countingTokens: false,
              tokenCount: exactCount !== null ? exactCount : a.tokenCount,
              tokenExact: exactCount !== null,
            }
      )
    );
  };

  const ingestFiles = async (files: File[]) => {
    const loaded: Attachment[] = [];
    let usedPayloadChars = attachments.reduce(
      (sum, a) => sum + (a.data?.length || a.textContent?.length || 0),
      0
    );

    const canFitPayload = (addedChars: number, fileName: string) => {
      if (usedPayloadChars + addedChars > MAX_SAFE_ATTACHMENTS_CHARS) {
        toast.error(
          `${fileName} melebihi batas total lampiran aman Vercel (~4.5 MB request limit).`
        );
        return false;
      }
      usedPayloadChars += addedChars;
      return true;
    };

    for (const file of files.slice(0, 6)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      if (file.type.startsWith('image/')) {
        const rawUrl = await readFileAsDataUrl(file);
        if (!rawUrl.split(',')[1]) continue;
        const img = await compressImageForPayload(rawUrl, file.type, file.size);
        if (!img.base64 || !canFitPayload(img.base64.length, file.name)) continue;
        const est = estimateAttachmentTokensLocal({
          kind: 'image',
          size: img.size,
          width: img.width,
          height: img.height,
        });
        loaded.push({
          id: generateId(),
          kind: 'image',
          name: file.name,
          mimeType: img.mimeType,
          size: img.size,
          data: img.base64,
          previewUrl: img.dataUrl,
          tokenCount: est,
          tokenExact: false,
        });
      } else if (file.type.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v'].includes(ext)) {
        if (file.size > MAX_SINGLE_BINARY_BYTES) {
          toast.error(`${file.name} (${formatBytes(file.size)}) terlalu besar untuk limit 4.5 MB Vercel (maks ~2.8 MB).`);
          continue;
        }
        const durationSec = await readMediaDuration(file, 'video');
        const dataUrl = await readFileAsDataUrl(file);
        const base64 = dataUrl.split(',')[1] || '';
        if (!base64 || !canFitPayload(base64.length, file.name)) continue;
        const est = estimateAttachmentTokensLocal({
          kind: 'video',
          size: file.size,
          durationSec,
        });
        loaded.push({
          id: generateId(),
          kind: 'video',
          name: file.name,
          mimeType: file.type || 'video/mp4',
          size: file.size,
          data: base64,
          durationSec,
          tokenCount: est,
          tokenExact: false,
        });
      } else if (file.type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
        if (file.size > MAX_SINGLE_BINARY_BYTES) {
          toast.error(`${file.name} (${formatBytes(file.size)}) terlalu besar untuk limit 4.5 MB Vercel (maks ~2.8 MB).`);
          continue;
        }
        const durationSec = await readMediaDuration(file, 'audio');
        const dataUrl = await readFileAsDataUrl(file);
        const base64 = dataUrl.split(',')[1] || '';
        if (!base64 || !canFitPayload(base64.length, file.name)) continue;
        const est = estimateAttachmentTokensLocal({
          kind: 'audio',
          size: file.size,
          durationSec,
        });
        loaded.push({
          id: generateId(),
          kind: 'audio',
          name: file.name,
          mimeType: file.type || 'audio/mpeg',
          size: file.size,
          data: base64,
          durationSec,
          tokenCount: est,
          tokenExact: false,
        });
      } else if (file.type === 'application/pdf' || ext === 'pdf') {
        if (file.size > MAX_SINGLE_BINARY_BYTES) {
          toast.error(`${file.name} (${formatBytes(file.size)}) terlalu besar untuk limit 4.5 MB Vercel (maks ~2.8 MB).`);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const base64 = dataUrl.split(',')[1] || '';
        if (!base64 || !canFitPayload(base64.length, file.name)) continue;
        const est = estimateAttachmentTokensLocal({
          kind: 'pdf',
          size: file.size,
        });
        loaded.push({
          id: generateId(),
          kind: 'pdf',
          name: file.name,
          mimeType: 'application/pdf',
          size: file.size,
          data: base64,
          tokenCount: est,
          tokenExact: false,
        });
      } else if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
        const textContent = (await file.text()).slice(0, 120000);
        if (!canFitPayload(textContent.length, file.name)) continue;
        const est = estimateAttachmentTokensLocal({
          kind: 'text',
          size: file.size,
          textContent,
        });
        loaded.push({
          id: generateId(),
          kind: 'text',
          name: file.name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          textContent,
          tokenCount: est,
          tokenExact: false,
        });
      }
    }

    if (loaded.length > 0) {
      setAttachments((prev) => [...prev, ...loaded]);
      toast.success(`${loaded.length} file ditambahkan`);
      for (const item of loaded) {
        void verifyExactTokensAsync(item);
      }
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

  const startAiAudioRecording = async () => {
    try {
      const recorder = new WavAudioRecorder();
      await recorder.start();
      wavRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      toast.error('Izin mikrofon ditolak atau tidak tersedia');
      setIsRecording(false);
    }
  };

  const stopAndTranscribeAiAudio = async () => {
    const recorder = wavRecorderRef.current;
    wavRecorderRef.current = null;
    setIsRecording(false);
    if (!recorder) return;

    const wavBlob = recorder.stop();
    if (wavBlob.size < 1200) {
      toast.error('Rekaman suara terlalu singkat.');
      return;
    }

    setIsTranscribing(true);
    setTranscribeStatus('Mengirim audio ke Gemini AI...');
    const result = await transcribeAudioWithAI({
      audioBlob: wavBlob,
      model,
      apiKey: settings.apiKey,
      onStatus: (msg) => setTranscribeStatus(msg),
    });
    setIsTranscribing(false);
    setTranscribeStatus('');

    if (result.ok && result.text) {
      setInput((prev) => (prev ? `${prev} ${result.text}` : result.text!));
      setTimeout(() => {
        textareaRef.current?.focus();
        adjustHeight();
      }, 20);
    } else {
      toast.error(result.error || 'Gagal mentranskrip suara');
    }
  };

  const startBrowserSpeech = () => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = 'id-ID';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript || '';
        if (res.isFinal) {
          finalChunk += transcript + ' ';
        } else {
          interimChunk += transcript;
        }
      }

      setInterimText(interimChunk);

      if (finalChunk.trim()) {
        const cleaned = normalizeTechTranscript(finalChunk);
        setInput((prev) => (prev ? `${prev} ${cleaned}` : cleaned));
        setTimeout(adjustHeight, 10);
      }
    };

    recognition.onerror = () => {
      setIsRecording(false);
      setInterimText('');
    };
    recognition.onend = () => {
      setIsRecording(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    setIsRecording(true);
    recognition.start();
  };

  const handleToggleMic = () => {
    if (!micAvailable || isTranscribing) return;

    if (isRecording) {
      if (wavRecorderRef.current) {
        void stopAndTranscribeAiAudio();
      } else {
        recognitionRef.current?.stop();
        setIsRecording(false);
        setInterimText('');
      }
      return;
    }

    if (useAiStt) {
      void startAiAudioRecording();
    } else {
      startBrowserSpeech();
    }
  };

  const handleCancelRecording = () => {
    if (wavRecorderRef.current) {
      wavRecorderRef.current.cancel();
      wavRecorderRef.current = null;
      setIsRecording(false);
    } else {
      recognitionRef.current?.stop();
      setIsRecording(false);
      setInterimText('');
    }
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
    if (isStreaming || isRecording || isTranscribing) return;
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
  const textDraftTokens = estimateTokens(input);
  const filesTotalTokens = attachments.reduce((acc, a) => acc + (a.tokenCount ?? 0), 0);
  const totalDraftTokens = textDraftTokens + filesTotalTokens;
  const thinkingCaps = useMemo(() => getModelThinkingCapabilities(model), [model]);
  const effectiveThinkingLevel = useMemo(
    () => resolveValidThinkingLevel(model, settings.thinkingLevel),
    [model, settings.thinkingLevel]
  );
  const thinkingOn =
    thinkingCaps.supported && settings.includeThoughts && effectiveThinkingLevel !== 'off';

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
            Lepaskan gambar, video, audio, PDF, atau file kode di sini
          </div>
        )}

        {(isRecording || isTranscribing) && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              {isTranscribing ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <span className="h-2.5 w-2.5 shrink-0 animate-ping rounded-full bg-rose-500" />
              )}
              <span className="truncate font-medium text-foreground">
                {isTranscribing
                  ? transcribeStatus || 'Mentranskrip suara dengan Gemini AI...'
                  : useAiStt
                    ? `Merekam WAV (${formatDuration(recordSeconds)}) — sebutkan istilah teknik apa saja`
                    : interimText
                      ? `Live: "${interimText}"`
                      : `Mendengarkan (${formatDuration(recordSeconds)})...`}
              </span>
            </div>

            {isRecording && (
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelRecording}
                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleToggleMic}
                  className="h-6 gap-1 rounded-lg px-2.5 text-[11px]"
                >
                  <Check className="h-3 w-3" />
                  Selesai
                </Button>
              </div>
            )}
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
          <div className="mb-2.5 space-y-2 px-1">
            <div className="flex flex-wrap gap-2">
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
                        className="h-16 w-20 object-cover transition-transform hover:scale-105"
                      />
                    </button>
                    <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-white">
                      {att.countingTokens && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                      {att.tokenExact ? '' : '~'}
                      {(att.tokenCount ?? 0).toLocaleString()} tok
                    </span>
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
                    {att.kind === 'video' ? (
                      <FileVideo className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : att.kind === 'audio' ? (
                      <FileAudio className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : att.kind === 'pdf' ? (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                    ) : (
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[120px] truncate font-mono text-[11px] font-medium">
                          {att.name}
                        </span>
                        {att.durationSec && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatDuration(att.durationSec)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                        <span>{formatBytes(att.size)}</span>
                        <span>•</span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1',
                            att.tokenExact ? 'text-emerald-400' : 'text-primary'
                          )}
                        >
                          {att.countingTokens && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                          {att.tokenExact ? '' : '~'}
                          {(att.tokenCount ?? 0).toLocaleString()} tok
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                      }
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {attachments.length} file terlampir (
                {attachments.every((a) => a.tokenExact)
                  ? 'Gemini exact count'
                  : 'estimasi / verifikasi'}
                )
              </span>
              <span className="font-mono font-medium text-primary">
                Total file: {filesTotalTokens.toLocaleString()} tok
              </span>
            </div>
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
              accept="image/*,video/*,audio/*,application/pdf,.txt,.md,.ts,.tsx,.js,.jsx,.json,.py,.css,.html,.sql,.csv,.xml,.yaml,.yml,.sh"
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
              title="Upload Gambar, Video, Audio, PDF, atau Kode"
            >
              <Paperclip className="h-4 w-4" />
              <span className="hidden text-xs sm:inline">File</span>
            </Button>

            <Button
              type="button"
              variant={thinkingOn ? 'secondary' : 'ghost'}
              size="sm"
              disabled={isStreaming || !thinkingCaps.supported}
              onClick={() => {
                const next = !thinkingOn;
                const nextLevel = next
                  ? effectiveThinkingLevel === 'off'
                    ? thinkingCaps.defaultLevel
                    : effectiveThinkingLevel
                  : thinkingCaps.canDisable
                    ? 'off'
                    : effectiveThinkingLevel;
                onUpdateSettings({
                  ...settings,
                  includeThoughts: next,
                  thinkingLevel: nextLevel,
                });
                toast.success(
                  next
                    ? `Thinking: ${THINKING_LEVEL_META[nextLevel].label}`
                    : 'Thinking Process: Nonaktif'
                );
              }}
              className={cn(
                'h-8 gap-1 rounded-xl px-2 text-xs',
                thinkingOn
                  ? 'border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title={thinkingCaps.note}
            >
              <Brain className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {thinkingOn ? THINKING_LEVEL_META[effectiveThinkingLevel].label : 'Think'}
              </span>
            </Button>

            <Button
              type="button"
              variant={settings.enableGoogleSearch ? 'secondary' : 'ghost'}
              size="sm"
              disabled={isStreaming}
              onClick={() => {
                const next = !settings.enableGoogleSearch;
                onUpdateSettings({ ...settings, enableGoogleSearch: next });
                toast.success(
                  next ? 'Google Search Grounding: Aktif' : 'Google Search Grounding: Nonaktif'
                );
              }}
              className={cn(
                'h-8 gap-1 rounded-xl px-2 text-xs',
                settings.enableGoogleSearch
                  ? 'border border-sky-500/35 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Google Search Grounding (riset web real-time & sitasi)"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Search</span>
            </Button>

            <Button
              type="button"
              variant={settings.enableUrlContext ? 'secondary' : 'ghost'}
              size="sm"
              disabled={isStreaming}
              onClick={() => {
                const next = !settings.enableUrlContext;
                onUpdateSettings({ ...settings, enableUrlContext: next });
                toast.success(next ? 'URL Context: Aktif' : 'URL Context: Nonaktif');
              }}
              className={cn(
                'h-8 gap-1 rounded-xl px-2 text-xs',
                settings.enableUrlContext
                  ? 'border border-emerald-500/35 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="URL Context (baca isi tautan/dokumentasi yang ditempel di prompt)"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden md:inline">URL</span>
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

            {micAvailable && (
              <Button
                type="button"
                variant={isRecording ? 'destructive' : 'ghost'}
                size="icon"
                onClick={handleToggleMic}
                disabled={isStreaming || isTranscribing}
                className="h-8 w-8 rounded-xl"
                title={
                  isRecording
                    ? 'Selesai & Transkrip'
                    : useAiStt
                      ? 'AI Voice Input (WAV 16kHz + Gemini AI)'
                      : 'Browser Voice Input'
                }
              >
                {isTranscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Mic
                    className={cn(
                      'h-4 w-4',
                      isRecording ? 'animate-pulse text-white' : 'text-muted-foreground'
                    )}
                  />
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
                        onClick={() => {
                          const recLevel = resolveValidThinkingLevel(
                            model,
                            p.recommendedThinkingLevel
                          );
                          onUpdateSettings({
                            ...settings,
                            activePersonaId: p.id,
                            systemInstruction: p.systemInstruction,
                            thinkingLevel: recLevel,
                            includeThoughts: recLevel !== 'off',
                          });
                        }}
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
                      <Mic className="h-3.5 w-3.5 text-primary" />
                      Mode Speech-to-Text
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, sttMode: 'ai' })}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors',
                        settings.sttMode === 'ai'
                          ? 'border-primary bg-primary/10 font-semibold text-primary'
                          : 'hover:bg-accent'
                      )}
                    >
                      Gemini AI (Akurat)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, sttMode: 'browser' })}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors',
                        settings.sttMode === 'browser'
                          ? 'border-primary bg-primary/10 font-semibold text-primary'
                          : 'hover:bg-accent'
                      )}
                    >
                      Browser Live
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Brain className="h-3.5 w-3.5 text-primary" />
                      Thinking Level
                    </span>
                    <Switch
                      checked={thinkingOn}
                      disabled={!thinkingCaps.supported}
                      onCheckedChange={(checked) =>
                        onUpdateSettings({
                          ...settings,
                          includeThoughts: checked,
                          thinkingLevel: checked
                            ? effectiveThinkingLevel === 'off'
                              ? thinkingCaps.defaultLevel
                              : effectiveThinkingLevel
                            : thinkingCaps.canDisable
                              ? 'off'
                              : effectiveThinkingLevel,
                        })
                      }
                    />
                  </div>
                  {thinkingCaps.supported ? (
                    <>
                      <div
                        className="grid gap-1"
                        style={{
                          gridTemplateColumns: `repeat(${thinkingCaps.supportedLevels.length}, minmax(0, 1fr))`,
                        }}
                      >
                        {thinkingCaps.supportedLevels.map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() =>
                              onUpdateSettings({
                                ...settings,
                                includeThoughts: lvl !== 'off',
                                thinkingLevel: lvl,
                              })
                            }
                            className={cn(
                              'rounded-md border py-1 font-mono text-[10px] transition-colors',
                              effectiveThinkingLevel === lvl
                                ? 'border-primary bg-primary/15 font-semibold text-primary'
                                : 'hover:bg-accent'
                            )}
                          >
                            {THINKING_LEVEL_META[lvl].label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        {thinkingCaps.note}
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">{thinkingCaps.note}</p>
                  )}
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
            {totalDraftTokens > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {totalDraftTokens.toLocaleString()} tok
              </span>
            )}

            <AnimatePresence mode="wait" initial={false}>
              {isStreaming ? (
                <motion.button
                  key="stop-btn"
                  type="button"
                  onClick={onStop}
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 450, damping: 28 }}
                  className="group relative inline-flex h-9 items-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-3.5 text-xs font-semibold text-rose-400 shadow-[0_0_20px_-5px_rgba(244,63,94,0.5)] transition-colors hover:border-rose-500/80 hover:bg-rose-500/25 hover:text-rose-300"
                  aria-label="Hentikan respon AI"
                >
                  <span className="relative flex h-4 w-4 items-center justify-center">
                    <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/45" />
                    <span className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full border border-rose-400/70">
                      <Square className="h-2 w-2 fill-current" />
                    </span>
                  </span>
                  <span>Stop</span>
                </motion.button>
              ) : (
                <motion.button
                  key="send-btn"
                  type="button"
                  onClick={submit}
                  disabled={(!input.trim() && attachments.length === 0) || isRecording || isTranscribing}
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  whileHover={
                    (input.trim() || attachments.length > 0) && !isRecording && !isTranscribing
                      ? { scale: 1.06 }
                      : undefined
                  }
                  whileTap={
                    (input.trim() || attachments.length > 0) && !isRecording && !isTranscribing
                      ? { scale: 0.92 }
                      : undefined
                  }
                  transition={{ type: 'spring', stiffness: 450, damping: 26 }}
                  className={cn(
                    'group inline-flex h-9 w-9 items-center justify-center rounded-xl transition-all',
                    (input.trim() || attachments.length > 0) && !isRecording && !isTranscribing
                      ? 'bg-primary text-primary-foreground shadow-[0_4px_18px_-3px_hsl(var(--primary)/0.65)] hover:brightness-110'
                      : 'cursor-not-allowed bg-muted/70 text-muted-foreground/45'
                  )}
                  aria-label="Kirim pesan"
                >
                  <ArrowUp className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
                </motion.button>
              )}
            </AnimatePresence>
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
});
