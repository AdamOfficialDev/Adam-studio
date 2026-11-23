import { PERSONA_PRESETS } from '@/lib/personas';
import type { AppSettings, Conversation, ThinkingLevel } from '@/types/chat';

const CONVERSATIONS_KEY = 'hydrogen-chat-conversations-v3';
const SETTINGS_KEY = 'hydrogen-chat-settings-v3';

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  githubToken: '',
  systemInstruction: PERSONA_PRESETS[0].systemInstruction,
  maxOutputTokens: 8192,
  includeThoughts: true,
  thinkingLevel: PERSONA_PRESETS[0].recommendedThinkingLevel,
  enableGoogleSearch: false,
  enableUrlContext: true,
  autoFallbackOnOverload: true,
  fallbackModel: 'gemini-3.8-flash',
  maxHistoryMessages: 0,
  sttMode: 'ai',
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
  const compact = conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map((msg) => ({
      ...msg,
      attachments: msg.attachments?.map((att) =>
        att.size > 350_000 ? { ...att, data: undefined, previewUrl: undefined } : att
      ),
    })),
  }));

  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(compact));
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
      // Abaikan jika penuh
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
    const parsed = JSON.parse(raw) as Partial<
      AppSettings & { theme?: 'dark' | 'light'; thinkingBudget?: number; temperature?: number }
    >;
    const skin =
      parsed.skin ?? (parsed.theme === 'light' ? 'paper' : DEFAULT_SETTINGS.skin);

    let thinkingLevel: ThinkingLevel =
      parsed.thinkingLevel ?? DEFAULT_SETTINGS.thinkingLevel;
    if (!parsed.thinkingLevel && typeof parsed.thinkingBudget === 'number') {
      if (parsed.thinkingBudget === 0) thinkingLevel = 'off';
      else if (parsed.thinkingBudget > 0 && parsed.thinkingBudget <= 2048) thinkingLevel = 'low';
      else if (parsed.thinkingBudget >= 12000) thinkingLevel = 'high';
      else thinkingLevel = 'medium';
    }

    const merged: AppSettings & { thinkingBudget?: number; temperature?: number } = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      thinkingLevel,
      skin,
    };
    delete merged.thinkingBudget;
    delete merged.temperature;
    return merged;
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
