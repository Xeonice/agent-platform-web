// 项目相关端点的错误码 → 人话（`lib/_shared/errorCopy` 的项目那一张表）。
//
// ★ **为什么必须有这张表**：这几条 message 是后端写给排查的人看的，逐条都带着
//   用户读不懂、也用不上的东西 —— 而它们此前**原封不动上了屏**：
//
//     retry-clone is only allowed on a failed project
//     project limit reached (max 50)                            ← 连错误码分支都没有
//     project 7f3a-… not found                                  ← 一串 UUID
//     git project requires repoUrl (I-PRJ)                      ← 内部不变量编号
//     project … is not ready for a task (clone_status=cloning)  ← 数据库字段名 + 枚举值
//     retained volume … is no longer on disk
//
// ⚠️ **`INVALID_STATE` 只在 override 里出现，这张共享表里刻意没有它**：同一个 409 在
//   [重试克隆] / [改为空项目] / [取消克隆] 上要说三句不同的话，而"这是哪个动作"只有
//   调用点知道。放一句通用的进来，等于让三条路共用一句都不太对的话。
import { describeErrorCode } from '@/lib/_shared/errorCopy';

/** 项目相关端点共用的码。上下文特有的（`INVALID_STATE`）在各自的 override 里。 */
export const PROJECT_ERROR_COPY: Readonly<Record<string, string>> = {
  PROJECT_LIMIT_REACHED: '项目数量已经到上限（最多 50 个）。先删掉一个用不上的项目，再建新的。',
  ALREADY_EXISTS: '项目名已存在，请换一个名称。',
  PROJECT_NOT_FOUND: '这个项目已经不在了（可能在别处被删掉了）。刷新一下列表再试。',
  INVALID_PROJECT_SOURCE: '克隆已有仓库要填仓库地址；空项目则不要填地址。',
  INVALID_REPO_URL: '这个仓库地址看起来不对，检查一下再试。',
  NOT_FOUND: '要操作的东西已经不在了（可能在别处被删掉了）。刷新一下再试。',
};

/** 「保留下来的成果」那条路特有的码。 */
export const RETAINED_VOLUME_ERROR_COPY: Readonly<Record<string, string>> = {
  ...PROJECT_ERROR_COPY,
  NOT_FOUND: '这份成果已经不在了（可能刚被自动清理）。',
  VOLUME_ARCHIVE_MISSING:
    '这份成果的文件在磁盘上已经找不到了，下载不了。这一条记录还在，可以直接删掉它。',
};

/**
 * 把 hook 拆开的信封字段翻成一句人话。
 *
 * @param code      `undefined` ⇒ 压根没拿到后端应答（网络断了）—— 由调用点单独处理，
 *                  这里按"查不到码"走 `fallback`。
 */
export function projectErrorMessage(
  code: string | undefined,
  traceId: string | undefined,
  fallback: string,
  overrides: Readonly<Record<string, string>> = PROJECT_ERROR_COPY,
): string {
  return describeErrorCode(code, { overrides, fallback, traceId });
}
