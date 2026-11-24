import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Menyalin teks dengan aman baik di HTTPS/localhost (Clipboard API)
 * maupun di HTTP LAN IP (fallback execCommand di container fokus aktif).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Lanjut ke fallback textarea
    }
  }

  if (typeof document === 'undefined') return false;

  const activeEl = document.activeElement as HTMLElement | null;
  const dialogContainer = activeEl?.closest('[role="dialog"]') as HTMLElement | null;
  const host = dialogContainer || document.body;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  host.appendChild(textarea);

  let ok = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    host.removeChild(textarea);
    if (activeEl && typeof activeEl.focus === 'function') {
      try {
        activeEl.focus({ preventScroll: true });
      } catch {
        // Abaikan jika elemen sudah unmount
      }
    }
  }

  return ok;
}

