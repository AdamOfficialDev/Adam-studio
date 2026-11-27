import { useSyncExternalStore } from 'react';
import type {
  DeviceApprovalRequest,
  EmergentClarification,
  GroundingMetadataInfo,
  TokenUsage,
  ToolTraceItem,
} from '@/types/chat';

export interface ActiveStreamState {
  convId: string;
  msgId: string;
  content: string;
  thought: string;
  statusText?: string;
  toolEvents?: ToolTraceItem[];
  clarification?: EmergentClarification;
  deviceApproval?: DeviceApprovalRequest | null;
  grounding?: GroundingMetadataInfo;
  tps: number;
  thinkingDurationMs?: number;
  usage?: TokenUsage;
}

let currentState: ActiveStreamState | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeStream(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveStreamSnapshot(): ActiveStreamState | null {
  return currentState;
}

export function setStreamState(next: ActiveStreamState | null): void {
  currentState = next;
  notify();
}

export function useActiveStream(): ActiveStreamState | null {
  return useSyncExternalStore(subscribeStream, getActiveStreamSnapshot, getActiveStreamSnapshot);
}

export function useIsStreamingActive(): boolean {
  return useSyncExternalStore(
    subscribeStream,
    () => currentState !== null,
    () => false
  );
}

export function useMessageStreamOverride(
  convId: string,
  msgId: string
): ActiveStreamState | null {
  return useSyncExternalStore(
    subscribeStream,
    () =>
      currentState && currentState.convId === convId && currentState.msgId === msgId
        ? currentState
        : null,
    () => null
  );
}
