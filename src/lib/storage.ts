import { PERSONA_PRESETS } from '@/lib/personas';
import type { AppSettings, Conversation } from '@/types/chat';

const CONVERSATIONS_KEY = 'hydrogen-chat-conversations-v3';
const SETTINGS_KEY = 'hydrogen-chat-settings-v3';

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  systemInstruction: PERSONA_PRESETS[0].systemInstruction,
  temperature: PERSONA_PRESETS[0].temperature,
  maxOutputTokens: 8192,
  includeThoughts: true,
  thinkingBudget: -1,
  autoFallbackOnOverload: false,
  fallbackModel: 'gemini-2.5-pro',
  maxHistoryMessages: 0,
  soundChime: true,
  demoMode: false,
  autoOpenArtifacts: false,
  activePersonaId: PERSONA_PRESETS[0].id,
  skin: 'obsidian',
  density: 'comfortable',
};

export function countApiKeys(raw: string): number {
  if (!raw) return 0;
  const unique = new Set(
    raw
      .split(/[\r\n,;]+/)
      .map((k) => k.trim())
      .filter(Boolean)
  );
  return unique.size;
}

export function loadConversations(): Conversation[] {
  try {
    const raw =
      localStorage.getItem(CONVERSATIONS_KEY) ||
      localStorage.getItem('hydrogen-chat-conversations-v2') ||
      localStorage.getItem('hydrogen-chat-conversations-v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  // Hindari menyimpan base64 media besar (>250KB) ke localStorage agar UI tetap kencang & bebas quota error
  const sanitized = conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map((msg) => ({
      ...msg,
      attachments: msg.attachments?.map((att) =>
        att.size > 250_000
          ? {
              ...att,
              data: undefined,
              previewUrl: undefined,
            }
          : att
      ),
    })),
  }));

  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(sanitized));
  } catch {
    try {
      const stripped = conversations.map((conv) => ({
        ...conv,
        messages: conv.messages.map((msg) => ({
          ...msg,
          attachments: msg.attachments?.map((att) => ({
            ...att,
            data: undefined,
            previewUrl: undefined,
          })),
        })),
      }));
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(stripped));
    } catch {
      // Abaikan jika quota penuh
    }
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw =
      localStorage.getItem(SETTINGS_KEY) ||
      localStorage.getItem('hydrogen-chat-settings-v2') ||
      localStorage.getItem('hydrogen-chat-settings-v1');
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings & { theme?: 'dark' | 'light' }>;
    const skin =
      parsed.skin ?? (parsed.theme === 'light' ? 'paper' : DEFAULT_SETTINGS.skin);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      skin,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Abaikan jika storage tidak tersedia
  }
}
