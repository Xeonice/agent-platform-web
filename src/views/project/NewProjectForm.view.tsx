// PRJ v2 creation fields. AppDialog supplies the title, description and focus trap.
import { useId, useState } from 'react';
import { CircleX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CreateProjectInput, ProjectSourceType } from '@/types/project';

export interface NewProjectFormProps {
  initialSourceType?: ProjectSourceType;
  focusRepository?: boolean;
  initialName?: string;
  suggestedEmptyName?: string;
  submitting?: boolean;
  errorMessage?: string;
  onSubmit: (input: CreateProjectInput) => void;
  onCancel?: () => void;
}

const inputClass =
  'h-9 w-full rounded-md border-0 bg-[var(--v2-surface)] px-3 shadow-[shadow:var(--v2-shadow-ring)] outline-none placeholder:text-[var(--v2-foreground-subtle)] hover:shadow-[0_0_0_1px_var(--v2-border-strong)] focus:shadow-[shadow:var(--v2-focus-input)] disabled:cursor-not-allowed disabled:bg-muted disabled:text-[var(--v2-foreground-disabled)]';
const radioClass =
  "relative m-0 grid size-4 shrink-0 appearance-none place-items-center rounded-full bg-[var(--v2-surface)] shadow-[inset_0_0_0_1px_var(--ds-gray-700)] before:size-2 before:scale-0 before:rounded-full before:bg-foreground before:content-[''] checked:shadow-[inset_0_0_0_1px_currentColor] checked:before:scale-100 focus-visible:shadow-[shadow:var(--v2-focus-ring)] disabled:cursor-not-allowed disabled:bg-muted disabled:before:bg-[var(--v2-foreground-disabled)]";

export function NewProjectFormView({
  initialSourceType = 'git',
  focusRepository = false,
  initialName = '',
  suggestedEmptyName = '未命名项目 1',
  submitting = false,
  errorMessage,
  onSubmit,
  onCancel,
}: NewProjectFormProps) {
  const [name, setName] = useState(initialName);
  const [sourceType, setSourceType] = useState<ProjectSourceType>(initialSourceType);
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('');
  const repositoryHelpId = useId();
  const repositoryId = useId();
  const trimmedName = name.trim();
  const trimmedRepo = repoUrl.trim();
  const trimmedBranch = repoBranch.trim();
  const canSubmit =
    trimmedName !== '' && (sourceType === 'empty' || trimmedRepo !== '') && !submitting;

  return (
    <form
      className="flex min-h-0 w-full flex-1 flex-col"
      aria-busy={submitting}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          name: trimmedName,
          sourceType,
          ...(sourceType === 'git' ? { repoUrl: trimmedRepo } : {}),
          ...(sourceType === 'git' && trimmedBranch !== '' ? { repoBranch: trimmedBranch } : {}),
        });
      }}
    >
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-4"
        data-project-form-body=""
      >
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">项目名称</span>
            <input
              type="text"
              name="project-name"
              autoFocus={!focusRepository || initialName.trim() === '' || sourceType !== 'git'}
              className={`${inputClass} text-sm`}
              value={name}
              readOnly={submitting}
              onChange={(event) => {
                setName(Array.from(event.target.value).slice(0, 40).join(''));
              }}
            />
          </label>
          <fieldset className="flex min-w-0 flex-col gap-2" disabled={submitting}>
            <legend className="mb-2 text-sm font-medium">来源</legend>
            <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
              <input
                className={radioClass}
                type="radio"
                name="source-type"
                value="git"
                checked={sourceType === 'git'}
                onChange={() => {
                  setSourceType('git');
                }}
              />
              <span>Git 仓库</span>
            </label>
            <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
              <input
                className={radioClass}
                type="radio"
                name="source-type"
                value="empty"
                checked={sourceType === 'empty'}
                onChange={() => {
                  setSourceType('empty');
                  if (name.trim() === '') setName(suggestedEmptyName);
                }}
              />
              <span>空项目</span>
            </label>
          </fieldset>
          {sourceType === 'git' && (
            <div className="flex flex-col gap-1.5 text-sm">
              <label htmlFor={repositoryId} className="font-medium">
                仓库地址
              </label>
              <input
                type="text"
                name="repo-url"
                id={repositoryId}
                aria-describedby={repositoryHelpId}
                autoFocus={focusRepository && initialName.trim() !== ''}
                placeholder="https://github.com/org/repo.git"
                className={`${inputClass} font-mono text-[13px]`}
                value={repoUrl}
                readOnly={submitting}
                onChange={(event) => {
                  setRepoUrl(event.target.value);
                }}
              />
              <span
                id={repositoryHelpId}
                className="text-[13px] leading-[18px] text-muted-foreground"
              >
                私有仓库需先配置 Git 凭证（凭证管理 › Git 凭证）。
              </span>
            </div>
          )}
          {sourceType === 'git' && (
            <label className="flex flex-col gap-1.5 text-sm" data-testid="repo-branch-field">
              <span className="font-medium">
                分支<span className="font-normal text-muted-foreground">（可选）</span>
              </span>
              <input
                type="text"
                name="repo-branch"
                placeholder="留空 = 仓库的默认分支"
                className={`${inputClass} font-mono text-[13px]`}
                value={repoBranch}
                readOnly={submitting}
                onChange={(event) => {
                  setRepoBranch(event.target.value);
                }}
              />
            </label>
          )}
        </div>
        {errorMessage !== undefined && errorMessage !== '' && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md bg-[var(--v2-status-fail-subtle-bg)] px-3 py-2 text-sm leading-[22px] shadow-[inset_0_0_0_1px_var(--v2-status-fail-subtle-border)]"
          >
            <CircleX
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-[var(--v2-status-fail-fg)]"
            />
            <p>{errorMessage}</p>
          </div>
        )}
      </div>
      <div
        className="flex shrink-0 items-center gap-2 border-t border-border bg-[var(--v2-surface-inset)] px-4 py-3"
        data-project-form-footer=""
      >
        {onCancel !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-0 bg-[var(--v2-surface)] shadow-[shadow:var(--v2-shadow-ring)]"
            disabled={submitting}
            onClick={onCancel}
          >
            取消
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          className="ml-auto disabled:bg-muted disabled:text-[var(--v2-foreground-disabled)] disabled:opacity-100 disabled:shadow-[shadow:var(--v2-shadow-ring)]"
          disabled={!canSubmit}
        >
          {submitting ? '创建中…' : '创建项目'}
        </Button>
      </div>
    </form>
  );
}
