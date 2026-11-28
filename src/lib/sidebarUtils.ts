import type { Conversation } from '@/types/chat';

export type SidebarFilter = 'all' | 'pinned' | 'emergent' | 'github' | 'device' | 'canvas';

export type SidebarDateBucket =
  | 'Hari Ini'
  | 'Kemarin'
  | '7 Hari Terakhir'
  | 'Bulan Ini'
  | 'Lebih Lama';

export const SIDEBAR_DATE_BUCKETS: SidebarDateBucket[] = [
  'Hari Ini',
  'Kemarin',
  '7 Hari Terakhir',
  'Bulan Ini',
  'Lebih Lama',
];

export interface SearchSnippetMatch {
  role: 'user' | 'assistant' | 'repo';
  before: string;
  match: string;
  after: string;
}

export function getDateBucket(timestamp: number): SidebarDateBucket {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOf7Days = startOfToday - 6 * 86_400_000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  if (timestamp >= startOfToday) return 'Hari Ini';
  if (timestamp >= startOfYesterday) return 'Kemarin';
  if (timestamp >= startOf7Days) return '7 Hari Terakhir';
  if (timestamp >= startOfMonth) return 'Bulan Ini';
  return 'Lebih Lama';
}

export function formatRelativeShort(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'baru';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}j`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return '1h';
  if (diffDay < 7) return `${diffDay}h`;
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function shortModelTag(modelId: string): string {
  if (modelId === 'gemini-4-hydrogen') return 'H4';
  if (modelId === 'gemini-2.5-pro') return '2.5P';
  if (modelId === 'gemini-2.5-flash') return '2.5F';
  if (modelId === 'gemini-3.8-flash') return '2.0F';
  return modelId.replace(/^gemini-/i, '').slice(0, 8);
}

export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function convHasCanvas(conv: Conversation): boolean {
  return conv.messages.some(
    (m) =>
      m.role === 'assistant' &&
      /```(?:html|htm|svg|mermaid|[a-z]+\n[\s\S]{150,})/i.test(m.content)
  );
}

export function convIsEmergent(conv: Conversation): boolean {
  return (
    conv.builderMode === 'emergent' ||
    Object.keys(conv.workspace?.files || {}).length > 0
  );
}

export function convIsDevice(conv: Conversation): boolean {
  return conv.builderMode === 'device';
}

export function convHasGitHub(conv: Conversation): boolean {
  return Boolean(conv.githubProject);
}

export function extractSearchSnippet(
  conv: Conversation,
  rawQuery: string
): SearchSnippetMatch | null {
  const q = rawQuery.trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  // Check messages from newest to oldest so the most recent match surfaces first
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const msg = conv.messages[i];
    if (!msg.content) continue;
    const cleanText = msg.content.replace(/\s+/g, ' ').trim();
    const idx = cleanText.toLowerCase().indexOf(qLower);
    if (idx !== -1) {
      const start = Math.max(0, idx - 26);
      const end = Math.min(cleanText.length, idx + q.length + 44);
      const before = (start > 0 ? '…' : '') + cleanText.slice(start, idx);
      const match = cleanText.slice(idx, idx + q.length);
      const after = cleanText.slice(idx + q.length, end) + (end < cleanText.length ? '…' : '');
      return {
        role: msg.role,
        before,
        match,
        after,
      };
    }
  }

  if (conv.githubProject) {
    const repoLabel = `${conv.githubProject.owner}/${conv.githubProject.repo}`;
    const idx = repoLabel.toLowerCase().indexOf(qLower);
    if (idx !== -1) {
      return {
        role: 'repo',
        before: repoLabel.slice(0, idx),
        match: repoLabel.slice(idx, idx + q.length),
        after: repoLabel.slice(idx + q.length),
      };
    }
  }

  return null;
}

export function splitHighlightText(
  text: string,
  rawQuery: string
): { before: string; match: string; after: string } | null {
  const q = rawQuery.trim();
  if (!q) return null;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + q.length),
    after: text.slice(idx + q.length),
  };
}
