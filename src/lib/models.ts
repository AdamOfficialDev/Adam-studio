import type { ThinkingLevel, TokenUsage } from '@/types/chat';

export type ModelCategory = 'Featured' | 'Gemini' | 'Custom';

export interface ThinkingCapabilities {
  supported: boolean;
  canDisable: boolean;
  supportedLevels: ThinkingLevel[];
  defaultLevel: ThinkingLevel;
  note: string;
}

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
  thinking?: ThinkingCapabilities;
}

export const THINKING_LEVEL_META: Record<
  ThinkingLevel,
  { label: string; shortDesc: string; apiValue: string | null }
> = {
  off: { label: 'Off', shortDesc: 'Tanpa reasoning tambahan', apiValue: 'OFF' },
  minimal: { label: 'Minimal', shortDesc: 'Ultra-cepat, reasoning ringan', apiValue: 'MINIMAL' },
  low: { label: 'Low', shortDesc: 'Cepat untuk task harian', apiValue: 'LOW' },
  medium: { label: 'Medium', shortDesc: 'Seimbang untuk coding & analisis', apiValue: 'MEDIUM' },
  high: { label: 'High', shortDesc: 'Deep reasoning & arsitektur kompleks', apiValue: 'HIGH' },
};

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
    thinking: {
      supported: true,
      canDisable: false,
      supportedLevels: ['low', 'medium', 'high'],
      defaultLevel: 'high',
      note: 'Model flagship reasoning: mendukung Low, Medium, dan High.',
    },
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description:
      'Model Flash generasi terbaru berlatensi rendah untuk chat real-time, transkripsi audio, dan ringkasan konteks cepat.',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    contextLimit: 1_000_000,
    contextLabel: '1M context',
    releaseDate: '2026',
    categories: ['Featured', 'Gemini'],
    thinking: {
      supported: true,
      canDisable: true,
      supportedLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      defaultLevel: 'medium',
      note: 'Seri Flash mendukung penuh Off, Minimal, Low, Medium, dan High.',
    },
  },
];

/**
 * Mendeteksi daftar thinkingLevel yang didukung secara otomatis berdasarkan
 * keluarga/pola nama model Google Gemini (termasuk Custom Model ID terbaru).
 */
export function getModelThinkingCapabilities(modelId: string): ThinkingCapabilities {
  const preset = PRESET_MODELS.find((m) => m.id === modelId);
  if (preset?.thinking) return preset.thinking;

  const id = (modelId || '').toLowerCase().trim();

  // Model legacy / non-thinking (Gemini 1.x, 2.0 non-thinking, Gemma, Imagen, Embedding)
  if (
    /gemini-1\./.test(id) ||
    (/gemini-2\.0/.test(id) && !/thinking/.test(id)) ||
    /gemma|embedding|imagen|veo/.test(id)
  ) {
    return {
      supported: false,
      canDisable: true,
      supportedLevels: [],
      defaultLevel: 'off',
      note: 'Model generasi ini tidak menggunakan parameter thinkingLevel.',
    };
  }

  // Gemini 2.0 Flash Thinking Experimental
  if (/gemini-2\.0.*thinking/.test(id)) {
    return {
      supported: true,
      canDisable: false,
      supportedLevels: ['medium'],
      defaultLevel: 'medium',
      note: 'Thinking aktif otomatis pada seri 2.0 Thinking.',
    };
  }

  // Gemini 2.5 Pro (wajib thinking, tidak bisa off/minimal)
  if (/gemini-2\.5-pro/.test(id)) {
    return {
      supported: true,
      canDisable: false,
      supportedLevels: ['low', 'medium', 'high'],
      defaultLevel: 'medium',
      note: 'Gemini 2.5 Pro mewajibkan thinking aktif (Low / Medium / High).',
    };
  }

  // Gemini 2.5 Flash / Flash-Lite (mendukung off, tanpa minimal)
  if (/gemini-2\.5/.test(id)) {
    return {
      supported: true,
      canDisable: true,
      supportedLevels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'medium',
      note: 'Seri Gemini 2.5 Flash mendukung Off, Low, Medium, dan High.',
    };
  }

  // Gemini 3.x / 4.x / masa depan varian Pro, Ultra, Deep Think, Hydrogen
  if (/pro|ultra|hydrogen|deep/.test(id) && !/flash/.test(id)) {
    return {
      supported: true,
      canDisable: false,
      supportedLevels: ['low', 'medium', 'high'],
      defaultLevel: 'high',
      note: 'Model flagship Pro/Reasoning mendukung Low, Medium, dan High.',
    };
  }

  // Gemini 3.x / 4.x / masa depan varian Flash / Lite (default modern Google)
  return {
    supported: true,
    canDisable: true,
    supportedLevels: ['off', 'minimal', 'low', 'medium', 'high'],
    defaultLevel: 'medium',
    note: 'Model Gemini modern (Flash/Lite) mendukung Off, Minimal, Low, Medium, High.',
  };
}

export function resolveValidThinkingLevel(
  modelId: string,
  desired: ThinkingLevel
): ThinkingLevel {
  const caps = getModelThinkingCapabilities(modelId);
  if (!caps.supported || caps.supportedLevels.length === 0) return 'off';
  if (caps.supportedLevels.includes(desired)) return desired;

  if (desired === 'off') {
    return caps.supportedLevels.includes('minimal')
      ? 'minimal'
      : caps.supportedLevels[0];
  }
  if (desired === 'minimal') {
    return caps.supportedLevels.includes('low') ? 'low' : caps.supportedLevels[0];
  }
  return caps.defaultLevel;
}

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
