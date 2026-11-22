export type ThemeSkin = 'obsidian' | 'claude' | 'aurora' | 'paper';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

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

export interface ToolTraceItem {
  id: string;
  name: string;
  argsSummary: string;
  status: 'running' | 'done' | 'error';
  resultSummary?: string;
}

export interface GitHubProjectFile {
  path: string;
  content: string;
  tokens: number;
}

export interface GitHubProjectContext {
  owner: string;
  repo: string;
  branch: string;
  isPrivate?: boolean;
  totalFiles: number;
  treePaths: string[];
  pinnedFiles: GitHubProjectFile[];
  agenticToolsEnabled: boolean;
  attachedAt: number;
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
  toolEvents?: ToolTraceItem[];
  visualTarget?: VisualTarget;
  attachments?: Attachment[];
  createdAt: number;
  model?: string;
  usage?: TokenUsage;
  metrics?: StreamMetrics;
  isStreaming?: boolean;
  stopped?: boolean;
  error?: string;
  isDemo?: boolean;
  starred?: boolean;
}

export interface CompactedContextState {
  mode: 'keep-latest-code' | 'ai-summary';
  summaryPrefix?: string;
  keepRecentCount: number;
  estimatedTokens: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  pinned?: boolean;
  personaId?: string;
  sessionSystemInstruction?: string;
  importedSource?: string;
  githubProject?: GitHubProjectContext;
  compactedContext?: CompactedContextState;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  apiKey: string;
  githubToken: string;
  systemInstruction: string;
  maxOutputTokens: number;
  includeThoughts: boolean;
  thinkingLevel: ThinkingLevel;
  autoFallbackOnOverload: boolean;
  fallbackModel: string;
  maxHistoryMessages: number;
  sttMode: 'ai' | 'browser';
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
  hasServerGithubToken?: boolean;
  demoModeEnv: boolean;
}
