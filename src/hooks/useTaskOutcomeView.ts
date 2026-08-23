// 终态呈现的派生层（hook 可 import lib；view 只吃派生结果，07 §3）。
// 存在的理由：`describeTaskOutcome` / `formatArtifactSize` 住在 lib，而 **view 与 container 都不能 import lib**
// （boundaries 07 §4.1）⇒ 派生必须落在 hook 这一层，view props 才拿得到成品文案。
import { useMemo } from 'react';
import { describeTaskOutcome, formatArtifactSize } from '@/lib/taskOutcome';
import type { TaskArtifact } from '@/types/task';
import type { TaskArtifactView, TaskExit, TaskOutcomeCopy } from '@/types/taskStream';

export interface TaskOutcomeView {
  /** null = 尚未终结（还在跑）。 */
  copy: TaskOutcomeCopy | null;
  artifacts: TaskArtifactView[];
}

export function useTaskOutcomeView(input: {
  /** 终态来源：WS exit 帧优先，刷新后回落到 DTO（容器已合并好）。 */
  exit: TaskExit | null;
  errorCode?: string;
  artifacts: readonly TaskArtifact[];
}): TaskOutcomeView {
  const { exit, errorCode, artifacts } = input;
  return useMemo(
    () => ({
      copy:
        exit === null
          ? null
          : describeTaskOutcome({ exit, ...(errorCode === undefined ? {} : { errorCode }) }),
      artifacts: artifacts.map((a) => ({
        name: a.name,
        sizeLabel: formatArtifactSize(a.size),
        modifiedAt: a.modifiedAt,
      })),
    }),
    [exit, errorCode, artifacts],
  );
}
