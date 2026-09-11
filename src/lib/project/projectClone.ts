// 项目克隆的纯派生（可单测）：进度百分比、失败错误码引导、就绪判定。UI 决策集中于此，view 只吃结果。
import type { ProjectCloneState, ProjectDto } from '@/types/project';

/** 项目是否就绪（可建沙箱）：cloneStatus 'ready'（空项目直接就绪 / git 克隆完成）。 */
export function isProjectReady(project: Pick<ProjectDto, 'cloneStatus'>): boolean {
  return project.cloneStatus === 'ready';
}

/**
 * 克隆进度百分比（0–100）：优先用后端 percent；否则用**对象数**比值；都没有则 null（indeterminate）。
 *
 * ⚠️ 兜底分支从前用的是 `receivedBytes / totalBytes`，而 `totalBytes` 是个幽灵字段——
 * git clone 不报总字节数，后端从来没发过。改用 `objectsDone / objectsTotal`：
 * `Enumerating objects: 26348` 在**开头**就报出来，是 git 唯一事前就知道的总量。
 */
export function cloneProgressPercent(state: ProjectCloneState): number | null {
  if (typeof state.percent === 'number') return clamp(Math.round(state.percent), 0, 100);
  if (
    typeof state.objectsDone === 'number' &&
    typeof state.objectsTotal === 'number' &&
    state.objectsTotal > 0
  ) {
    return clamp(Math.round((state.objectsDone / state.objectsTotal) * 100), 0, 100);
  }
  return null;
}

/**
 * git 阶段 → 中文 + **序号**。填住 receiving 之前那段"一个数都没有"的空窗。
 *
 * ★ **序号 `(4/6)` 不是装饰，它是唯一在解释"进度条为什么会重来一遍"的东西。**
 *   git 的每个阶段各自从 0% 数到 100%（`git-cloner.port.ts:58-63` 已把这一点记为
 *   已知未修），所以用户会眼看着同一根条子 0→100 走好几遍。没有序号的时候，
 *   那看起来就是"卡住了又重来"，而它其实是正常推进 —— 界面此前一个字都没解释。
 *   有了 `(4/6)`，同一件事读起来是"第 4 段跑完了，还有 2 段"。
 *
 * ⚠️ 分母是**这张表的长度**，不是写死的 6：加一个阶段就自动变 7，
 *   ⛔ 不许把 6 硬编码到句子里（那正是下一个人加阶段时会漏掉的地方）。
 */
const STAGE_LABEL: Record<NonNullable<ProjectCloneState['stage']>, string> = {
  enumerating: '枚举远端对象',
  counting: '清点对象',
  compressing: '远端压缩',
  receiving: '接收对象',
  resolving: '解析增量',
  checkout: '检出文件',
};

/**
 * 阶段顺序（git 实际走的先后）。
 * `satisfies` 挡住写错的阶段名；漏写一个只会让那一阶段退回"只给名字不给序号"，
 * 不会编出一个错的序号（见下面 `index < 0` 那一支）。
 */
const STAGE_ORDER = [
  'enumerating',
  'counting',
  'compressing',
  'receiving',
  'resolving',
  'checkout',
] as const satisfies readonly NonNullable<ProjectCloneState['stage']>[];

export function cloneStageLabel(stage: ProjectCloneState['stage']): string | undefined {
  if (stage === undefined) return undefined;
  const index = (STAGE_ORDER as readonly string[]).indexOf(stage);
  const label = STAGE_LABEL[stage];
  // 表里没有的阶段（后端加了新值而这里还没跟上）⇒ 只给名字，⛔ 不编一个假的序号。
  return index < 0 ? label : `${label}（第 ${String(index + 1)}/${String(STAGE_ORDER.length)} 步）`;
}

/** 速率，如 `1.2 MB/s`。 */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** 已用时长 `m:ss`（超过一小时给 `h:mm:ss`）。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${String(h)}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** 人类可读字节。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i] ?? 'GB'}`;
}

export interface CloneFailureGuidance {
  /** 面向用户的引导文案。 */
  message: string;
  /** 重试是否可能有效（PERMISSION 需凭证，重试无用）。 */
  canRetry: boolean;
  /** 需要凭证（S3：就地引导跳凭证页配置后回程重试克隆）。 */
  needsCredentials: boolean;
}

/** 失败错误码 → 分支引导（未知码走通用重试）。 */
export function cloneFailureGuidance(errorCode: string | undefined): CloneFailureGuidance {
  switch (errorCode) {
    case 'CLONE_FAILED_PERMISSION':
      // 这一条现在**只**在远端真的回绝了一个凭证时出现（401/403/publickey/Authentication
      // failed）。「Repository not found」已经拆去 `CLONE_FAILED_NOT_FOUND` —— 见下一条。
      return {
        message:
          '远端拒绝了这次访问：凭证无效或没有这个仓库的权限。配置 Git 访问凭证后可重试克隆。',
        canRetry: false,
        needsCredentials: true,
      };

    /**
     * ★ **「打不开」不等于「没权限」。**
     *
     * 后端对 `Repository not found` / 404 单独发这个码，因为它**分不出**是哪一种：
     * 私有仓没配凭证、和地址写错一个字母，在 git 那里长得一模一样（远端故意如此——
     * 回 403 就等于承认这个私有仓存在）。
     *
     * ⛔ 所以这句话**不许断言其中任何一种**。旧文案说的是「没有访问该仓库的权限」，
     * 对地址打错的用户而言那是**假的**：他会被送去配一个根本不缺的凭证，而只读条
     * 明写着不能改远端 —— 唯一真正的出路（删掉重建）此前一个字都没提。
     *
     * 两条出路都给：配凭证（界面上有按钮）+ 删掉重建（没有按钮，所以必须写进句子里）。
     */
    case 'CLONE_FAILED_NOT_FOUND':
      return {
        message:
          '打不开这个仓库：可能是私有仓库还没配 Git 凭证，也可能是地址写错了。' +
          '如果是私有仓库，配好凭证后可以重试克隆；如果是地址写错了，远端地址建好之后改不了，' +
          '需要删掉这个项目重新建一个。',
        canRetry: false,
        needsCredentials: true,
      };
    case 'CLONE_FAILED_NETWORK':
      return {
        message: '网络错误导致克隆失败，请检查网络后重试。',
        canRetry: true,
        needsCredentials: false,
      };
    case 'TIMEOUT':
      return {
        message: '克隆超时（仓库较大或网络较慢），可重试。',
        canRetry: true,
        needsCredentials: false,
      };
    case 'INTERRUPTED':
      return { message: '克隆被中断，请重试。', canRetry: true, needsCredentials: false };
    /**
     * ★ **「重试克隆」≠「重新创建」，这里曾经把两者说混了。**
     *
     * 旧文案让用户「清理磁盘后**重新创建**」。可失败的这个项目**还在**、还占着 50 个
     * 名额里的一个 —— 照做的结果是多出一个项目，而不是修好这一个。这正是本页
     * 「重试克隆保留项目 / 重新创建另起一个」这条区分要防的事。
     *
     * ⚠️ `canRetry` 由 false 改为 true，与信封里的 `retryable` **不矛盾**，两者问的
     * 不是同一个问题：`retryable` 说的是「把这个请求原样再发一次会不会成功」（不会，
     * 盘还是满的）；这里的 `canRetry` 决定的是**清完盘之后用户按的那个按钮在不在**。
     * 藏掉它，用户腾出了空间也没有路可以回到这个项目上。
     */
    case 'DISK_INSUFFICIENT':
      return {
        message:
          '磁盘空间不足，没能克隆完。清理出空间后可以在这个项目上重试克隆；也可以改为空项目。',
        canRetry: true,
        needsCredentials: false,
      };
    default:
      return { message: '克隆失败，请重试。', canRetry: true, needsCredentials: false };
  }
}
