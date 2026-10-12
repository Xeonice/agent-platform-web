import type { operations } from '@/types/generated/openapi';
export type { UpgradeRecovery } from '@/types/upgrade-contract';
// Public wire types are generated from the real API emitter. The canonical
// shared Zod schemas additionally validate responses at the network boundary.
export type UpgradeStatus =
  operations['UpgradeController_status']['responses'][200]['content']['application/json'];
export type UpgradeRequest =
  operations['UpgradeController_request']['requestBody']['content']['application/json'];
export type UpgradeAttempt =
  operations['UpgradeController_request']['responses'][202]['content']['application/json'];
export type UpgradeContractRequest =
  operations['UpgradeController_contractRequest']['requestBody']['content']['application/json'];
export type UpgradeContractAttempt =
  operations['UpgradeController_contractRequest']['responses'][202]['content']['application/json'];

/** Immutable identity compiled into the actual loaded Web artifact, never read from API. */
export interface LoadedWebBuild {
  webRevision: string | null;
  releaseId: string | null;
  builtAt: string | null;
}
export interface UpgradeObservation {
  snapshot: UpgradeStatus | null;
  receivedAt: number;
  uncertain: boolean;
  reason: string | null;
}
export interface UpgradeDisplayModel {
  phase: 'none' | 'available' | 'ongoing' | 'ready' | 'unknown' | 'failed' | 'recovery';
  showEntry: boolean;
  showDot: boolean;
  title: string;
  subtitle: string;
  percent: number | null;
  progressText: string | null;
  lastSeenText: string | null;
  canUpgrade: boolean;
  canRefresh: boolean;
  canAuthenticate: boolean;
  facts: { label: string; value: string }[];
  artifactDetails: { label: string; value: string }[];
}
export interface UpgradeViewActions {
  onCheck: () => void;
  onUpgrade: () => void;
  onRefresh: () => void;
  onLater: () => void;
  onDetails: () => void;
}
export interface ContractFinalizeDisplay {
  visible: boolean;
  canExecute: boolean;
  status: string;
  reason: string | null;
  facts: { label: string; value: string }[];
}
