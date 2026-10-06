import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiErrorException } from '@/services/api/apiError';
import { provisionPresetImage } from '@/services/api/system.service';
import type { ProvisionStageFrame } from '@/types/sse-protocol';

/**
 * [准备镜像] —— 让平台把预制镜像放到位（P21-8 §2 ⇒ 新判据）。
 *
 * ⚠️ **它只管这一次搬运的过程，不管「搬完了没有」这个结论。** 结论的唯一出处是镜像检查
 * 那一项 —— 搬完之后要重跑一次检查，而不是由本 hook 自行宣布就绪。两个真相源会打架：
 * 本 hook 说成功了、检查仍是红的，用户不知道该信谁。⇒ `onFinished` 交给调用方去触发重新检测。
 */

const STAGE_LABEL: Readonly<Record<ProvisionStageFrame['stage'], string>> = {
  plan: '看这台机器够不够得着镜像',
  fetch: '下载',
  verify: '校验完整性',
  load: '装载镜像',
  // ⚠️ **不写死终点**（2026-09-10）：这一步在 `local-docker`/`release-asset` 那几条路上
  //    是推到镜像仓库，而在另一条上是沙箱环境自己拉进本机镜像库 ——⛔ 一个「推送到镜像
  //    仓库」会把后者说成一件它没做的事。终点由后端那句 message 说（它带着真实去向），
  //    这里只给一个不预设去向的阶段名。
  register: '放到位',
};

export interface UsePresetImageProvisionResult {
  isProvisioning: boolean;
  notice?: string;
  disabledReason?: string;
  /** 当前阶段的一句话。⛔ **失败在哪一步必须说得出**（五阶段的下一步各不相同）。 */
  statusText: string | undefined;
  error: string | undefined;
  /**
   * 当前帧的 0–1 进度——原样转发 `ProvisionStageFrame.progress`，⛔ **不做任何换算/估算**。
   * `undefined` = 这一轮还没开始；`null` = 后端这一帧给不出分母（docker 的进度帧不一定带
   * `total`），界面要画不确定态，⛔ 不许当 0 用（那会显示一个停在 0% 不动的进度条，
   * 与"卡死了"在观感上完全一致）。
   */
  progress: number | null | undefined;
  /**
   * 本次搬运的真实挂钟时长，仅 isProvisioning 为真时递增，结束或尚未开始为 undefined。
   * 时长与字节进度分别计算；进度不变时不能伪造增量。
   */
  elapsedSeconds: number | undefined;
  start: () => void;
}

export function usePresetImageProvision(
  onFinished: () => void,
  /**
   * **进第 3 步且平台自己搬得了 ⇒ 自己开始**（`autoStageOffer`，用户 2026-09-10 裁决）。
   *
   * ⚠️ **只自动开一次**，靠 `autoStartedRef`。三个必须挡住的重开：
   *   ① 组件重渲染 —— 依赖变了 effect 会再跑；
   *   ② **搬失败之后** —— 自动重试一个几百 MB 的下载是在替用户做一个他没同意的决定，
   *      失败时该做的是把失败在哪一步说清楚，让他自己点 [准备镜像]；
   *   ③ 用户点了 [稍后配置，下一步] 又 [上一步] 回来 —— 那时若还没铺完，本来就还在跑。
   */
  autoStart = false,
): UsePresetImageProvisionResult {
  const [isProvisioning, setProvisioning] = useState(false);
  const [statusText, setStatusText] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<string>();
  const [disabledReason, setDisabledReason] = useState<string>();
  const activeRunRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** 自动只开一次。⛔ 不是 state：它不该触发重渲染，也不该被重置。 */
  const autoStartedRef = useRef(false);

  const start = useCallback(() => {
    if (activeRunRef.current || disabledReason !== undefined) return;
    activeRunRef.current = true;
    setNotice(undefined);
    // ⚠️ 掐掉上一条流（连点）—— 与诊断同一条重入保护。⛔ 后端也有并发闸，但那会返 409；
    //    在这里先掐掉，用户看到的就不是一条报错而是"重新开始"。
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProvisioning(true);
    setError(undefined);
    setStatusText('正在开始…');
    setProgress(undefined);

    void provisionPresetImage(
      {
        onStage: (f) => {
          if (controller.signal.aborted) return;
          // ⚠️ `skipped` 要说出来。把没发生的步骤悄悄跳过，用户会以为校验做过了。
          const mark = f.status === 'skipped' ? '（跳过）' : '';
          setStatusText(`${STAGE_LABEL[f.stage]}${mark}：${f.message}`);
          // ⚠️ 原样转发，⛔ 不做二次判断——`null` 与数字都是合法取值，见类型上的注释。
          setProgress(f.progress);
        },
        onDone: (f) => {
          if (controller.signal.aborted) return;
          activeRunRef.current = false;
          setProvisioning(false);
          if (f.ok) {
            setStatusText('已下载到本机，正在重新检测…');
            onFinished();
          } else {
            // ⛔ 失败时**保留最后一条阶段文案**：它说的是失败在哪一步，而那正是下一步的依据。
            setError(f.error ?? '准备失败，但平台没有说明原因');
          }
        },
      },
      controller.signal,
    ).catch((e: unknown) => {
      if (controller.signal.aborted) return;
      activeRunRef.current = false;
      setProvisioning(false);
      if (
        e instanceof ApiErrorException &&
        e.envelope.code === 'PRESET_IMAGE_PROVISION_IN_FLIGHT'
      ) {
        setNotice('已经在下载了（之前发起的那一次还没结束），稍后回来看。');
        setStatusText(undefined);
      } else if (
        e instanceof ApiErrorException &&
        e.envelope.code === 'PRESET_IMAGE_NOT_PROVISIONABLE'
      ) {
        setDisabledReason(e.envelope.message);
        setError(e.envelope.message);
      } else setError(e instanceof Error ? e.message : '准备镜像失败');
    });
  }, [onFinished, disabledReason]);

  // 真实挂钟时长使用 Date.now() 差值，每秒刷新；未运行或结束后不继续计时。
  useEffect(() => {
    if (!isProvisioning) {
      setElapsedSeconds(undefined);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [isProvisioning]);

  // ⚠️ **effect 里只做「够不够条件」这一个判断**，判定本身在 `autoStageOffer`（纯函数、
  //    有自己的用例）。⛔ 不要把 `phase`/`state`/`provision` 那三条揉进这里：那会让
  //    「什么时候该自动开始」变成一段没人能单测的 effect。
  useEffect(() => {
    if (!autoStart) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    start();
  }, [autoStart, start]);

  return {
    isProvisioning,
    statusText,
    error,
    progress,
    elapsedSeconds,
    notice,
    disabledReason,
    start,
  };
}
