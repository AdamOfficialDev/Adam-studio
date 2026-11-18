import type { TokenUsage } from '@/types/chat';

export type ModelCategory = 'Featured' | 'Gemini' | 'Custom';

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  contextLimit: number;
  contextLabel: string;
  releaseDate: string;
  isNew?: boolean;
  categories: ModelCategory[];
}

export const DEFAULT_MODEL_ID = 'gemini-4-hydrogen';

export const PRESET_MODELS: ModelInfo[] = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    description:
      'An efficient model with cutting-edge intelligence for fast, dependable execution across coding, agentic workflows, and multimodal knowledge work.',
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 7.5,
    contextLimit: 1_000_000,
    contextLabel: 'All context lengths',
    releaseDate: 'Nov 13, 2026',
    isNew: true,
    categories: ['Featured', 'Gemini'],
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description:
      'Flagship reasoning & coding model for deep multi-step architecture, debugging, and large repository synthesis.',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    contextLimit: 1_000_000,
    contextLabel: '1M context',
    releaseDate: '2025',
    categories: ['Featured', 'Gemini'],
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description:
      'High-speed multimodal model tuned for low-latency SSE interactivity and cost-efficient daily tasks.',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextLimit: 1_000_000,
    contextLabel: '1M context',
    releaseDate: '2025',
    categories: ['Featured', 'Gemini'],
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description:
      'Dependable fast model for general multimodal prompts, summarization, and real-time chat.',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    contextLimit: 1_000_000,
    contextLabel: '1M context',
    releaseDate: '2024',
    categories: ['Gemini'],
  },
];

export function getModelInfo(modelId: string): ModelInfo {
  const found = PRESET_MODELS.find((m) => m.id === modelId);
  if (found) return found;

  return {
    id: modelId,
    name: modelId,
    description: 'Custom model identifier forwarded directly to the Gemini SSE endpoint.',
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 7.5,
    contextLimit: 1_000_000,
    contextLabel: 'Custom endpoint',
    releaseDate: 'Custom',
    categories: ['Custom'],
  };
}

export function estimateCostNumber(modelId: string, usage?: TokenUsage): number {
  if (!usage) return 0;
  const info = getModelInfo(modelId);
  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;
  return (
    (inputTokens / 1_000_000) * info.inputPricePerMillion +
    (outputTokens / 1_000_000) * info.outputPricePerMillion
  );
}

export function estimateCostUsd(modelId: string, usage?: TokenUsage): string | null {
  const cost = estimateCostNumber(modelId, usage);
  if (cost <= 0) return null;
  return cost < 0.0001 ? '<$0.0001' : `$${cost.toFixed(4)}`;
}
