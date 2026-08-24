// 新建项目弹窗的内容（F21-6 §9.4）：name + 来源（git 填 repoUrl + **分支** / 空项目）。
// 纯展示，本地受控 state，零副作用；外壳（overlay + 标题 + [✕]）由 `ModalShell.view` 提供。
//
// ⚠️ **它此前不是弹窗**：`currentModal==='createProject'` 这个名字是假的——
// `WorkbenchContainer` 把它 return 成 `mainContent`，是主区换页（F21-2 §N.0）。
// 本轮与「新建任务」走同一套 overlay，**形态对称**。
//
// ⚠️ `CreateProjectRequest.repoBranch` **契约里一直有**（生成物里就有这个可选字段），
// 表单从来没接 —— 于是"克隆哪个分支"这件事在界面上无法表达，只能拿远端默认分支。
// 本轮补上：**留空 = 远端默认分支**（不填就不发这个字段，与新建任务的分支缺省同一条纪律）。
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
  const [repoBranch, setRepoBranch] = useState('');

  const trimmedName = name.trim();
  const trimmedRepo = repoUrl.trim();
  const trimmedBranch = repoBranch.trim();
  const canSubmit =
    trimmedName !== '' && (sourceType === 'empty' || trimmedRepo !== '') && !submitting;

  return (
    <form
      className="flex w-full flex-col gap-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          name: trimmedName,
          sourceType,
          ...(sourceType === 'git' ? { repoUrl: trimmedRepo } : {}),
          // 留空 ⇒ **不发这个字段**，由后端走远端默认分支（不自作主张填 'main'：
          // 远端默认分支叫什么是远端说了算，前端猜一个名字迟早猜错）。
          ...(sourceType === 'git' && trimmedBranch !== '' ? { repoBranch: trimmedBranch } : {}),
        });
      }}
    >
      <p className="text-sm text-muted-foreground">从 Git 仓库克隆，或创建一个空项目</p>

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

      {/* 空项目没有远端，也就没有"克隆哪个分支"这个问题 ⇒ 整块不渲染（与新建任务弹窗一致）。 */}
      {sourceType === 'git' && (
        <label className="flex flex-col gap-1 text-sm" data-testid="repo-branch-field">
          <span className="text-muted-foreground">分支（可选）</span>
          <input
            type="text"
            name="repo-branch"
            placeholder="留空 = 远端默认分支"
            className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={repoBranch}
            disabled={submitting}
            onChange={(e) => {
              setRepoBranch(e.target.value);
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
