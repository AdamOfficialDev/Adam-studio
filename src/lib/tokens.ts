import type { Attachment } from '@/types/chat';

export function estimateImageTokens(width: number, height: number): number {
  if (!width || !height) return 258;
  if (width <= 384 && height <= 384) return 258;
  const cols = Math.ceil(width / 768);
  const rows = Math.ceil(height / 768);
  return Math.max(258, cols * rows * 258);
}

export function estimateAttachmentTokensLocal(params: {
  kind: Attachment['kind'];
  size: number;
  textContent?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}): number {
  if (params.kind === 'text') {
    return Math.max(1, Math.ceil((params.textContent?.length ?? params.size) / 4));
  }
  if (params.kind === 'image') {
    return estimateImageTokens(params.width ?? 0, params.height ?? 0);
  }
  if (params.kind === 'video') {
    // Gemini video (~258-300 tok/s termasuk audio track)
    return Math.max(263, Math.round((params.durationSec ?? 5) * 263));
  }
  if (params.kind === 'audio') {
    // Gemini audio (~32 tok/s)
    return Math.max(32, Math.round((params.durationSec ?? 5) * 32));
  }
  // PDF heuristic (~258 tok per halaman / ~1.5KB per token teks+visual)
  return Math.max(258, Math.round(params.size / 1400));
}

export async function fetchExactAttachmentTokens(params: {
  model: string;
  attachment: Attachment;
  apiKey?: string;
}): Promise<number | null> {
  try {
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

    const requestBody = JSON.stringify({
      model: params.model,
      attachment: {
        kind: params.attachment.kind,
        name: params.attachment.name,
        mimeType: params.attachment.mimeType,
        data: params.attachment.data,
        textContent: params.attachment.textContent,
      },
    });

    if (new TextEncoder().encode(requestBody).length > 3_800_000) {
      return null;
    }

    const res = await fetch('/api/count-tokens', {
      method: 'POST',
      headers,
      body: requestBody,
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; totalTokens?: number };
    if (data?.ok && typeof data.totalTokens === 'number') {
      return data.totalTokens;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
