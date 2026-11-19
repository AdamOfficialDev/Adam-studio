export type ThemeSkin = 'obsidian' | 'claude' | 'aurora' | 'paper';

export interface Attachment {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'text';
  name: string;
  mimeType: string;
  size: number;
  data?: string;
  textContent?: string;
  previewUrl?: string;
  durationSec?: number;
  tokenCount?: number;
  tokenExact?: boolean;
  countingTokens?: boolean;
}

export interface VisualTarget {
  id: string;
  tagName: string;
  selector: string;
  textSnippet: string;
  outerHtml: string;
}

export interface TokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface StreamMetrics {
  ttftMs?: number;
  thinkingDurationMs?: number;
  durationMs?: number;
  tokensPerSec?: number;
}

export interface ArtifactItem {
  id: string;
  title: string;
  language: string;
  content: string;
  kind: 'html' | 'svg' | 'markdown' | 'mermaid' | 'code';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  statusText?: string;
  visualTarget?: VisualTarget;
  attachments?: Attachment[];
  createdAt: number;
  model?: string;
  usage?: TokenUsage;
  metrics?: StreamMetrics;
  isStreaming?: boolean;
  error?: string;
  isDemo?: boolean;
  starred?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  pinned?: boolean;
  personaId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  apiKey: string;
  systemInstruction: string;
  temperature: number;
  maxOutputTokens: number;
  includeThoughts: boolean;
  thinkingBudget: number;
  autoFallbackOnOverload: boolean;
  fallbackModel: string;
  maxHistoryMessages: number;
  soundChime: boolean;
  demoMode: boolean;
  autoOpenArtifacts: boolean;
  activePersonaId: string;
  skin: ThemeSkin;
  density: 'comfortable' | 'compact';
}

export interface ServerHealth {
  ok: boolean;
  defaultModel: string;
  hasServerApiKey: boolean;
  serverKeyCount?: number;
  demoModeEnv: boolean;
}
