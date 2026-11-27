export type ThemeSkin = 'obsidian' | 'claude' | 'aurora' | 'paper';
export type BuilderMode = 'chat' | 'emergent' | 'device';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';
export type DeviceApprovalMode = 'always' | 'high-risk' | 'autonomous';
export type DevicePlatform = 'desktop' | 'android';

export interface DeviceInfo {
  id: string;
  name: string;
  platform: DevicePlatform;
  os: string;
  screenWidth: number;
  screenHeight: number;
  status: 'online' | 'busy' | 'paused' | 'offline';
  isSimulator?: boolean;
  connectedAt: number;
  lastSeenAt: number;
  lastAction?: string;
}

export interface DeviceScreenFrame {
  deviceId: string;
  platform: DevicePlatform;
  imageBase64: string;
  mimeType: string;
  width: number;
  height: number;
  cursorX?: number;
  cursorY?: number;
  actionLabel?: string;
  capturedAt: number;
}

export interface DeviceApprovalRequest {
  approvalId: string;
  deviceId: string;
  toolName: string;
  riskLevel: 'medium' | 'high';
  summary: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export interface DeviceActionLog {
  id: string;
  toolName: string;
  summary: string;
  status: 'running' | 'done' | 'error' | 'denied';
  cursorX?: number;
  cursorY?: number;
  timestamp: number;
}

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

export interface GroundingSource {
  title?: string;
  uri: string;
}

export interface UrlContextItem {
  url: string;
  status?: string;
}

export interface GroundingMetadataInfo {
  webSearchQueries?: string[];
  sources?: GroundingSource[];
  urlContexts?: UrlContextItem[];
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

export interface EmergentClarificationOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface EmergentClarificationQuestion {
  id: string;
  question: string;
  type: 'single' | 'multiple' | 'input';
  placeholder?: string;
  allowCustomInput?: boolean;
  options?: EmergentClarificationOption[];
}

export interface EmergentClarification {
  id: string;
  title: string;
  subtitle?: string;
  recommendation?: string;
  questions: EmergentClarificationQuestion[];
  submitted?: boolean;
  submittedSummary?: string;
}
export interface EmergentPlanTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  detail?: string;
}

export interface EmergentPlan {
  title: string;
  summary: string;
  stack: string[];
  tasks: EmergentPlanTask[];
  status: 'planning' | 'building' | 'verifying' | 'ready' | 'error';
  updatedAt: number;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  language: string;
  updatedAt: number;
}

export interface VirtualWorkspace {
  files: Record<string, WorkspaceFile>;
  activePath: string;
  entryPath: string;
  plan?: EmergentPlan;
  lastBuildError?: string | null;
  daytonaSandboxId?: string;
  daytonaPreviewUrl?: string;
  daytonaPreviewToken?: string;
  updatedAt: number;
}

export interface GitHubProjectContext {
  owner: string;
  repo: string;
  branch: string;
  commitSha?: string;
  isPrivate?: boolean;
  totalFiles: number;
  treePaths: string[];
  pinnedFiles: GitHubProjectFile[];
  agenticToolsEnabled: boolean;
  attachedAt: number;
  lastSyncedAt?: number;
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
  clarification?: EmergentClarification;
  grounding?: GroundingMetadataInfo;
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
  builderMode?: BuilderMode;
  workspace?: VirtualWorkspace;
  compactedContext?: CompactedContextState;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  daytonaApiKey?: string;
  daytonaApiUrl?: string;
  apiKey: string;
  githubToken: string;
  systemInstruction: string;
  maxOutputTokens: number;
  includeThoughts: boolean;
  thinkingLevel: ThinkingLevel;
  enableGoogleSearch: boolean;
  enableUrlContext: boolean;
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
  deviceApprovalMode?: DeviceApprovalMode;
}

export interface ServerHealth {
  ok: boolean;
  defaultModel: string;
  hasServerApiKey: boolean;
  serverKeyCount?: number;
  hasServerGithubToken?: boolean;
  demoModeEnv: boolean;
}
