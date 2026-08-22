// SYNC WITH product/22-异常场景与产品补充要求.md §1（错误码 → 用户语义映射）——修改需与产品口径对表。
//
// P22 §1 的原则：**每条错误必须同时给「发生了什么（人话）」和「现在能做什么（按钮）」，禁止裸抛错误码**。
// 因此本表的每一条都强制带 `actions`（至少一条），由 view 渲染成按钮。纯函数、零依赖，可单测。
// 注意分层：lib 只能依赖 lib/type（07 §4.1），故错误信封形状直接取生成物，不经 services。
import type { components } from '@/types/generated/openapi';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/** 失败卡上可点的动作。container 负责把 key 接到真实 handler。 */
export interface SandboxErrorAction {
  /** `retry` = 用同样的配置再来一次；`reconfigure` = 回到新建入口改配置（换镜像/换档位）。 */
  key: 'retry' | 'reconfigure';
  label: string;
}

export interface SandboxErrorCopy {
  /** 原始错误码（诊断用；不直接展示给用户，展示的是 title/advice）。 */
  code: string;
  /** 人话：发生了什么。 */
  title: string;
  /** 现在能做什么 / 为什么会这样。 */
  advice: string;
  actions: readonly SandboxErrorAction[];
  /**
   * 后端给的**自由文本**失败细节（`SandboxResponseDto.failureMessage`），排障用小字。
   * ⚠️ 只原样透出，**不参与任何判定**——码与文本已由后端拆成两列，禁止从这里 parse 码。
   */
  detail?: string;
}

const RETRY: SandboxErrorAction = { key: 'retry', label: '重试' };

/**
 * P22 §1 表的前端落点。只列**本切片链路上真会触达用户**的码；
 * 未收录的码走 `fallbackCopy`（仍然给人话 + 一个可点动作，不裸抛码）。
 */
const COPY_TABLE: Record<string, Omit<SandboxErrorCopy, 'code'>> = {
  // —— S5 新增两条 ——
  INSTALL_FAILED: {
    title: '❌ 运行时 CLI 安装失败（该镜像未预装，现装未成功）',
    advice:
      '安装发生在「启动实例」阶段内，失败时任务已停止。可以重试一次；反复失败建议换一张**预装该 CLI**的镜像（未预装的镜像现装可能耗时十几分钟）。',
    actions: [RETRY, { key: 'reconfigure', label: '换一张预装该 CLI 的镜像' }],
  },
  IMAGE_CONTRACT_VIOLATION: {
    title: '❌ 镜像不满足平台约定（缺少 tmux），任务已停止',
    advice:
      '这张镜像注册时通过了校验，但真正启动时实测发现缺 tmux（镜像换了 tag 或上游变更）。tmux 是必须项——没有它，平台一重启就会丢掉正在跑的 agent 会话，因此不做静默降级。',
    // ⚠️ P22 §1 明写**不给 [重试]**：重试不会改变镜像内容，只是再失败一次。
    actions: [{ key: 'reconfigure', label: '换一张含 tmux 的镜像' }],
  },

  // —— 既有码（P22 §1 同表）——
  IMAGE_PULL_FAILED: {
    title: '❌ 镜像拉取失败（网络或镜像名错误）',
    advice: '检查网络与镜像地址后重试。',
    actions: [RETRY, { key: 'reconfigure', label: '检查镜像地址' }],
  },
  MANIFEST_INVALID: {
    title: '❌ 镜像不满足平台约定',
    advice: '该镜像未通过平台校验（如缺少 tmux 等必须项），请改用合格镜像。',
    actions: [{ key: 'reconfigure', label: '换一张镜像' }],
  },
  RESOURCE_EXHAUSTED: {
    title: '❌ 当前任务较多，资源暂时不足',
    advice: '停止部分任务释放资源，或稍后重试。',
    actions: [
      { key: 'retry', label: '稍后重试' },
      { key: 'reconfigure', label: '返回任务列表' },
    ],
  },
  PROVIDER_UNAVAILABLE: {
    title: '🔴 运行时无响应（容器服务未启动？）',
    advice: '容器服务可能未启动，确认后重试。',
    actions: [RETRY],
  },
  TIMEOUT: {
    title: '⏱️ 操作超时',
    advice: '可以重试；若持续超时请检查容器服务负载。',
    actions: [RETRY],
  },
  INVALID_STATE: {
    title: '⚠️ 当前状态不允许此操作',
    advice: '状态已变化，刷新后按新状态操作。',
    actions: [{ key: 'retry', label: '刷新重试' }],
  },
};

/**
 * 「零副作用」的创建期拒绝码（10 §6.1 / 04 §5，能力静态校验）。
 *
 * ⚠️ 这是本文件最要紧的一条区分：能力静态校验发生在**解析项目 / 落库 / 进调度之前**，
 * 409 时前端**拿不到 sandbox id，列表里也不会留下 failed 记录** ⇒ 它**不能**走
 * "创建失败可重试"的失败卡路径（那条路径预设"已落库、中途失败"，会渲染出一个并不存在的任务）。
 * 正确呈现：**就地**在新建入口提示改选档位/能力，用户改完再点创建。
 * 对照：`INSTALL_FAILED` 是已落库、`starting` 中途失败 ⇒ 走正常失败态。
 */
const ZERO_SIDE_EFFECT_CODES = new Set(['UNSUPPORTED_CAPABILITY']);

export function isZeroSideEffectRejection(httpStatus: number, code: string): boolean {
  return httpStatus === 409 && ZERO_SIDE_EFFECT_CODES.has(code);
}

/** 零副作用拒绝的**就地**提示文案（不含任何"重试/重新创建"语义）。 */
export function capabilityRejectionMessage(error: Pick<ErrorEnvelope, 'message'>): string {
  const reason = error.message !== '' ? error.message : '所选运行档位不满足要求的能力';
  return `无法用当前配置创建：${reason}。请改选运行档位或调整能力要求后再试（本次请求未创建任何任务）。`;
}

/** 未收录码的兜底：仍给人话 + 一个可点动作（P22 §1 禁止裸抛错误码）。 */
function fallbackCopy(code: string, message?: string): SandboxErrorCopy {
  return {
    code,
    title: '❌ 任务启动失败',
    advice:
      message !== undefined && message !== ''
        ? message
        : '未能获取具体原因，可以重试一次；若持续失败请查看系统状态。',
    actions: [RETRY, { key: 'reconfigure', label: '返回重新配置' }],
  };
}

/** 沙箱**已停止**（非失败）时的呈现——与失败区分，不出红字错误码。 */
export const SANDBOX_ENDED_COPY: SandboxErrorCopy = {
  code: 'ENDED',
  title: '沙箱已停止',
  advice: '该任务的沙箱已结束，可以重新创建一个。',
  actions: [{ key: 'reconfigure', label: '重新创建' }],
};

/**
 * 错误码 → 人话 + 可操作建议。
 *
 * `code` 的来源只有两条（两者写同一个 store 字段，故此处只需处理一份）：
 *   · WS `sandbox.status_changed.errorCode`（即时）；
 *   · REST `SandboxResponseDto.failureCode`（刷新恢复）。
 * `code` 缺失（旧数据/异常路径）仍必须返回一份可渲染的兜底文案，不裸抛码。
 *
 * `detail` = `failureMessage`（自由文本），原样带出给排障小字用。
 */
export function describeSandboxError(input: {
  code?: string;
  message?: string;
  detail?: string;
}): SandboxErrorCopy {
  const code = input.code ?? '';
  const detail = input.detail === undefined || input.detail === '' ? {} : { detail: input.detail };
  const entry = COPY_TABLE[code];
  if (entry === undefined) {
    return { ...fallbackCopy(code === '' ? 'UNKNOWN' : code, input.message), ...detail };
  }
  return { code, ...entry, ...detail };
}
