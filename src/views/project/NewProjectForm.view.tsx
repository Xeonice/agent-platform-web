// 新建项目表单（10 §7）：name + 来源(git 填 repoUrl / 空项目)。纯展示，本地受控 state，零副作用。
// 「来源」仅用于创建，repoUrl 不回读、不展示于任何列表/详情（产品红线）。
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CreateProjectInput, ProjectSourceType } from '@/types/project';

export interface NewProjectFormProps {
  submitting?: boolean;
  errorMessage?: string;
  onSubmit: (input: CreateProjectInput) => void;
  onCancel?: () => void;
}

export function NewProjectFormView({
  submitting = false,
  errorMessage,
  onSubmit,
  onCancel,
}: NewProjectFormProps) {
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<ProjectSourceType>('git');
  const [repoUrl, setRepoUrl] = useState('');

  const trimmedName = name.trim();
  const trimmedRepo = repoUrl.trim();
  const canSubmit =
    trimmedName !== '' && (sourceType === 'empty' || trimmedRepo !== '') && !submitting;

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          name: trimmedName,
          sourceType,
          ...(sourceType === 'git' ? { repoUrl: trimmedRepo } : {}),
        });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">新建项目</h2>
        <p className="mt-1 text-sm text-muted-foreground">从 Git 仓库克隆，或创建一个空项目</p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">项目名称</span>
        <input
          type="text"
          name="project-name"
          autoFocus
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={name}
          disabled={submitting}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>

      <fieldset className="flex flex-col gap-2" disabled={submitting}>
        <legend className="mb-1 text-xs text-muted-foreground">来源</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="source-type"
            value="empty"
            checked={sourceType === 'empty'}
            onChange={() => {
              setSourceType('empty');
            }}
          />
          <span>空项目</span>
        </label>
      </fieldset>

      {sourceType === 'git' && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">仓库地址</span>
          <input
            type="text"
            name="repo-url"
            placeholder="https://github.com/org/repo.git"
            className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={repoUrl}
            disabled={submitting}
            onChange={(e) => {
              setRepoUrl(e.target.value);
            }}
          />
        </label>
      )}

      {errorMessage !== undefined && errorMessage !== '' && (
        <p role="alert" className="text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? '创建中…' : '创建项目'}
        </Button>
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" disabled={submitting} onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </form>
  );
}
