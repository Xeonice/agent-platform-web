import { useCallback, useEffect, useRef, useState } from 'react';
import { provisionPresetImage } from '@/services/api/system.service';
import type { ProvisionStageFrame } from '@/types/sse-protocol';

/**
 * [准备镜像] —— 让平台把预制镜像搬到位（P21-8 §2 ⇒ 新判据）。
 *
 * ⚠️ **它只管这一次搬运的过程，不管「搬完了没有」这个结论。** 结论的唯一出处是诊断第 ⑧ 项
 * ——搬完之后要重跑一次检查，而不是由本 hook 自行宣布就绪。两个真相源会打架：本 hook 说
 * 成功了、检查链仍是红的，用户不知道该信谁。⇒ `onFinished` 交给调用方去触发重新检测。
 */

const STAGE_LABEL: Readonly<Record<ProvisionStageFrame['stage'], string>> = {
  plan: '判断字节够不够得着',
  fetch: '取资产',
  verify: '校验 sha256',
  load: '装载镜像',
  // ⚠️ **不写死终点**（2026-09-10）：这一步在 `local-docker`/`release-asset` 那几条路上
  //    是 push 到 registry，而在 `provider-stage` 那条上是 provider 自己拉进本机镜像库
  //    ——⛔ 一个「推送到 registry」会把后者说成一件它没做的事。终点由后端那句 message 说
  //    （它带着 `plan.to`），这里只给一个不预设去向的阶段名。
  register: '铺到位',
};

export interface UsePresetImageProvisionResult {
  isProvisioning: boolean;
  /** 当前阶段的一句话。⛔ **失败在哪一步必须说得出**（五阶段的下一步各不相同）。 */
  statusText: string | undefined;
  error: string | undefined;
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
  const abortRef = useRef<AbortController | null>(null);
  /** 自动只开一次。⛔ 不是 state：它不该触发重渲染，也不该被重置。 */
  const autoStartedRef = useRef(false);

  const start = useCallback(() => {
    // ⚠️ 掐掉上一条流（连点）—— 与诊断同一条重入保护。⛔ 后端也有并发闸，但那会返 409；
    //    在这里先掐掉，用户看到的就不是一条报错而是"重新开始"。
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProvisioning(true);
    setError(undefined);
    setStatusText('正在开始…');

    void provisionPresetImage(
      {
        onStage: (f) => {
          if (controller.signal.aborted) return;
          const pct = f.progress === null ? '' : ` · ${String(Math.round(f.progress * 100))}%`;
          // ⚠️ `skipped` 要说出来。把没发生的步骤悄悄跳过，用户会以为校验做过了。
          const mark = f.status === 'skipped' ? '（跳过）' : '';
          setStatusText(`${STAGE_LABEL[f.stage]}${mark}：${f.message}${pct}`);
        },
        onDone: (f) => {
          if (controller.signal.aborted) return;
          setProvisioning(false);
          if (f.ok) {
            setStatusText('已搬到位，正在重新检测…');
            onFinished();
          } else {
            // ⛔ 失败时**保留最后一条阶段文案**：它说的是失败在哪一步，而那正是下一步的依据。
            setError(f.error ?? '搬运失败，但后端没有说明原因');
          }
        },
      },
      controller.signal,
    ).catch((e: unknown) => {
      if (controller.signal.aborted) return;
      setProvisioning(false);
      setError(e instanceof Error ? e.message : '搬运失败');
    });
  }, [onFinished]);

  // ⚠️ **effect 里只做「够不够条件」这一个判断**，判定本身在 `autoStageOffer`（纯函数、
  //    有自己的用例）。⛔ 不要把 `phase`/`state`/`provision` 那三条揉进这里：那会让
  //    「什么时候该自动开始」变成一段没人能单测的 effect。
  useEffect(() => {
    if (!autoStart) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    start();
  }, [autoStart, start]);

  return { isProvisioning, statusText, error, start };
}
