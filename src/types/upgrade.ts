import type { operations } from '@/types/generated/openapi';
export type { UpgradeRecovery } from '@/types/upgrade-contract';
// Public wire types are generated from the real API emitter. The canonical
// shared Zod schemas additionally validate responses at the network boundary.
export type UpgradeStatus =
  operations['UpgradeController_status']['responses'][200]['content']['application/json'];
export type UpgradeRequest =
  operations['UpgradeController_request']['requestBody']['content']['application/json'];
type UpgradeAcceptance =
  operations['UpgradeController_request']['responses'][202]['content']['application/json'];
export type UpgradeAttempt = Extract<UpgradeAcceptance, { attemptId: string }>;
export type UpgradeOperation = Extract<UpgradeAcceptance, { operationId: string }>;
export type UpgradeCommandResult = UpgradeAttempt | UpgradeOperation;
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
  phase: 'pending' | 'none' | 'available' | 'ongoing' | 'ready' | 'unknown' | 'failed' | 'recovery';
  showEntry: boolean;
  showDot: boolean;
  title: string;
  subtitle: string;
  percent: number | null;
  progressText: string | null;
  lastSeenText: string | null;
  canUpgrade: boolean;
  canRefresh: boolean;
  facts: { label: string; value: string }[];
  artifactDetails: { label: string; value: string }[];
  stageProgress?: {
    label: string;
    percent: number | null;
    workText: string | null;
    elapsedText: string | null;
    lastProgressText: string | null;
    stale: boolean;
  };
  completionSummary?: string;
  upgradeActionLabel?: string;
  canContinueWorking?: boolean;
  diagnosticText?: string;
  recoverySummary?: {
    stateText: string;
    phaseText: string | null;
    confirmedAt: string | null;
    lastObservedAt: string;
    stale: boolean;
  };
}
export interface UpgradeViewActions {
  onCheck: () => void;
  onUpgrade: () => void;
  onRefresh: () => void;
  onLater: () => void;
  onDetails: () => void;
  onContinue?: () => void;
  onCopyDiagnostics?: () => void;
}
export interface ContractFinalizeDisplay {
  visible: boolean;
  canExecute: boolean;
  status: string;
  reason: string | null;
  facts: { label: string; value: string }[];
}
