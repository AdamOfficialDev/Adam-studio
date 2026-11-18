import type { Attachment } from '@/types/chat';

export async function getMediaDuration(file: File, kind: 'video' | 'audio'): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = 'metadata';

    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    }, 1800);

    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;
      URL.revokeObjectURL(url);
      resolve(dur);
    };

    el.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(undefined);
    };

    el.src = url;
  });
}

export async function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

export async function estimatePdfPages(file: File): Promise<number> {
  try {
    const sample = await file.slice(0, 2_000_000).text();
    const matches = sample.match(/\/Type\s*\/Page\b(?!s)/g);
    if (matches && matches.length > 0) return matches.length;
  } catch {
    // Abaikan jika gagal baca
  }
  return Math.max(1, Math.round(file.size / 45_000));
}

export function estimateAttachmentTokensLocal(params: {
  kind: Attachment['kind'];
  size: number;
  textContent?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  pdfPages?: number;
}): number {
  const { kind, size, textContent, width, height, durationSec, pdfPages } = params;

  if (kind === 'text') {
    return Math.max(1, Math.ceil((textContent?.length ?? size) / 4));
  }

  if (kind === 'image') {
    if (width && height) {
      if (width <= 384 && height <= 384) return 258;
      const tiles = Math.max(1, Math.ceil(width / 768) * Math.ceil(height / 768));
      return Math.min(6, tiles) * 258;
    }
    return 258;
  }

  if (kind === 'video') {
    if (durationSec && durationSec > 0) {
      // Gemini rate: ~263 video frames/sec + ~32 audio tokens/sec
      return Math.max(295, Math.round(durationSec * 295));
    }
    return Math.max(500, Math.round((size / 120_000) * 295));
  }

  if (kind === 'audio') {
    if (durationSec && durationSec > 0) {
      return Math.max(32, Math.round(durationSec * 32));
    }
    return Math.max(64, Math.round((size / 16_000) * 32));
  }

  if (kind === 'pdf') {
    const pages = pdfPages || Math.max(1, Math.round(size / 45_000));
    return pages * 258;
  }

  return Math.max(1, Math.ceil(size / 4));
}

export async function countAttachmentTokensExact(params: {
  model: string;
  apiKey: string;
  attachment: Attachment;
}): Promise<number | null> {
  const { model, apiKey, attachment } = params;

  // Hindari mengirim payload base64 raksasa (>3.8MB) ke serverless /countTokens
  const approxPayloadSize = attachment.data?.length ?? attachment.textContent?.length ?? 0;
  if (approxPayloadSize > 3_800_000) {
    return null;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const normalizedKeys = (apiKey || '')
    .split(/[\r\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (normalizedKeys.length > 0) {
    headers['x-gemini-api-key'] = normalizedKeys.join(',');
  }

  try {
    const res = await fetch('/api/count-tokens', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        attachment: {
          kind: attachment.kind,
          name: attachment.name,
          mimeType: attachment.mimeType,
          data: attachment.data,
          textContent: attachment.textContent,
        },
      }),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as { totalTokens?: number };
    return typeof json.totalTokens === 'number' ? json.totalTokens : null;
  } catch {
    return null;
  }
}
