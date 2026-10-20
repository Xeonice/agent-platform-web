import { type Ref } from 'react';
import {
  VersionUpdateDetailsView,
  type VersionUpdateDetailsProps,
} from '@/views/system/VersionUpdateDetails.view';
import {
  ContractFinalizeView,
  type ContractFinalizeProps,
} from '@/views/system/ContractFinalize.view';

function stateAnnouncement(model: VersionUpdateDetailsProps['model']): string {
  if (model.recoverySummary !== undefined) {
    return [model.recoverySummary.stateText, model.recoverySummary.phaseText]
      .filter((text) => text !== null)
      .join('。');
  }
  if (model.phase === 'ongoing') {
    const stage = model.stageProgress;
    return [
      model.title,
      model.progressText ?? '等待进度确认',
      stage === undefined
        ? null
        : `${stage.stale ? '上次确认：' : ''}${stage.label}${stage.percent === null ? '' : ` · ${String(stage.percent)}%（仅当前阶段）`}`,
    ]
      .filter((text) => text !== null)
      .join('。');
  }
  return `${model.title}。${model.subtitle}`;
}

interface Props extends VersionUpdateDetailsProps {
  headingRef: Ref<HTMLHeadingElement>;
  contractFinalize?: ContractFinalizeProps;
}
export function VersionUpdateCardView({ headingRef, contractFinalize, ...details }: Props) {
  return (
    <section
      id="version"
      aria-labelledby="system-version-heading"
      className="rounded-lg border border-border p-4"
    >
      <h2
        id="system-version-heading"
        ref={headingRef}
        tabIndex={-1}
        className="mb-3 text-base font-semibold"
      >
        版本与更新
      </h2>
      <p
        role="status"
        aria-label="升级与恢复状态"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {stateAnnouncement(details.model)}
      </p>
      <VersionUpdateDetailsView {...details} />
      {contractFinalize === undefined ? null : <ContractFinalizeView {...contractFinalize} />}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">运行产物详情</summary>
        <dl className="mt-2 space-y-1">
          {details.model.artifactDetails.map((fact) => (
            <div key={fact.label}>
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="break-all font-mono">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
