const TECH_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:ui\s*ux|yu\s*ai\s*yu\s*eks|yu\s*i\s*yu\s*x|yui\s*ux|yui\s*ex|u\s*i\s*u\s*x)\b/gi, 'UI/UX'],
  [/\b(?:es\s*es\s*e|e\s*s\s*e|s\s*s\s*e)\b/gi, 'SSE'],
  [/\b(?:ef\s*pi\s*ai|a\s*p\s*i)\b/gi, 'API'],
  [/\b(?:api\s*ki|api\s*key)\b/gi, 'API key'],
  [/\b(?:taip\s*skrip|taipekrip|type\s*script)\b/gi, 'TypeScript'],
  [/\b(?:java\s*skrip|japa\s*skrip|java\s*script)\b/gi, 'JavaScript'],
  [/\b(?:shad\s*cn|set\s*cn|syad\s*cn|shet\s*sien|cat\s*cn)\b/gi, 'shadcn'],
  [/\b(?:pi\s*en\s*pi\s*em|p\s*n\s*p\s*m)\b/gi, 'pnpm'],
  [/\b(?:en\s*pi\s*em|n\s*p\s*m)\b/gi, 'npm'],
  [/\b(?:fait\s*js|vite\s*js|vait)\b/gi, 'Vite'],
  [/\b(?:riyek|react\s*js)\b/gi, 'React'],
  [/\b(?:ver\s*sel|fersel)\b/gi, 'Vercel'],
  [/\b(?:geit\s*hub|kit\s*hub|git\s*hub)\b/gi, 'GitHub'],
  [/\b(?:je\s*son|jayson)\b/gi, 'JSON'],
  [/\b(?:ha\s*te\s*em\s*el|h\s*t\s*m\s*l)\b/gi, 'HTML'],
  [/\b(?:ce\s*es\s*es|c\s*s\s*s)\b/gi, 'CSS'],
  [/\b(?:es\s*ke\s*el|es\s*kiu\s*el|s\s*q\s*l)\b/gi, 'SQL'],
  [/\b(?:pe\s*we\s*a|p\s*w\s*a)\b/gi, 'PWA'],
  [/\b(?:ai\s*studio)\b/gi, 'AI Studio'],
  [/\b(?:gemini\s*empat\s*hidrogen|gemini\s*4\s*hidrogen)\b/gi, 'Gemini 4 Hydrogen'],
];

export function normalizeTechTranscript(rawText: string): string {
  let out = rawText.trim();
  for (const [pattern, replacement] of TECH_TERM_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function encodeWav16kHz(chunks: Float32Array[], inputSampleRate: number): Blob {
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;

  const merged = new Float32Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.length;
  }

  const targetRate = 16000;
  const ratio = Math.max(1, inputSampleRate / targetRate);
  const outLength = Math.max(1, Math.floor(merged.length / ratio));

  const buffer = new ArrayBuffer(44 + outLength * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + outLength * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, outLength * 2, true);

  for (let i = 0; i < outLength; i++) {
    const startIdx = Math.floor(i * ratio);
    const endIdx = Math.min(merged.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = startIdx; j < endIdx; j++) {
      sum += merged[j];
      count += 1;
    }
    const sample = count > 0 ? sum / count : (merged[startIdx] ?? 0);
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export class WavAudioRecorder {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 48000;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    this.audioCtx = new AudioCtx();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    this.sampleRate = this.audioCtx.sampleRate || 48000;
    this.chunks = [];

    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.silentGain = this.audioCtx.createGain();
    this.silentGain.gain.value = 0;

    this.processor.onaudioprocess = (event) => {
      const channelData = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(channelData));
    };

    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioCtx.destination);
  }

  stop(): Blob {
    const recorded = this.chunks;
    const rate = this.sampleRate;
    this.cleanup();
    if (recorded.length === 0) {
      return new Blob([], { type: 'audio/wav' });
    }
    return encodeWav16kHz(recorded, rate);
  }

  cancel(): void {
    this.cleanup();
  }

  private cleanup(): void {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.silentGain?.disconnect();
    } catch {
      // Abaikan
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close().catch(() => {});
    }
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.stream = null;
    this.audioCtx = null;
    this.chunks = [];
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Gagal membaca audio'));
    reader.readAsDataURL(blob);
  });
}

export async function transcribeAudioWithAI(params: {
  audioBlob: Blob;
  model?: string;
  apiKey?: string;
}): Promise<{ ok: boolean; text?: string; error?: string }> {
  const base64 = await blobToBase64(params.audioBlob);
  if (!base64) {
    return { ok: false, error: 'Rekaman suara kosong.' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const normalizedKeys = (params.apiKey || '')
    .split(/[\r\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  if (normalizedKeys.length > 0) {
    headers['x-gemini-api-key'] = normalizedKeys.join(',');
  }

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
      mimeType: 'audio/wav',
      data: base64,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    text?: string;
    message?: string;
  };

  if (!res.ok || !data.ok || !data.text) {
    return { ok: false, error: data.message || `Gagal transkripsi (${res.status})` };
  }

  return { ok: true, text: data.text.trim() };
}
