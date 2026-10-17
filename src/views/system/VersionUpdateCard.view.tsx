import { type Ref } from 'react';
import {
  VersionUpdateDetailsView,
  type VersionUpdateDetailsProps,
} from '@/views/system/VersionUpdateDetails.view';
import {
  ContractFinalizeView,
  type ContractFinalizeProps,
} from '@/views/system/ContractFinalize.view';

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
