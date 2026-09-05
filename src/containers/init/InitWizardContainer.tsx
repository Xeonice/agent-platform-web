'use client';
// 初始化向导的容器（F21-8 §3）。**唯一的 view ↔ hook 粘合点**：取数、SSE 编排、mutation
// 全在 `useInitWizard`；判定、单位换算、文案挑选全在 `lib/system/`；这里只做步骤分发与回调接线。
//
// ⛔ **本容器刻意不接 `useEscapeKey`，也不提供任何 `onClose`/`onCancel`。**
//    这是全局 Esc 分层规则（P20 §8.4）的**唯一例外**（F21-8 §2 阻塞语义）：向导是放行卡点，
//    关掉它之后没有"回到哪里"—— `AppBootGate` 在 `initialized === false` 时压根不挂载工作台，
//    所以逃逸出去只会得到一张白屏。⇒ 谁要在这里加 Esc/取消，请先回答"关掉之后用户看到什么"。
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useInitWizard } from '@/hooks/system/useInitWizard';
import { usePresetImageProvision } from '@/hooks/system/usePresetImageProvision';
import { InitWizardShellView } from '@/views/init/InitWizardShell.view';
import { ConnectivityCheckView } from '@/views/init/ConnectivityCheck.view';
import { ProxyConfigFormView } from '@/views/init/ProxyConfigForm.view';
import { OfflineNoticeView } from '@/views/init/OfflineNotice.view';
import { PresetImageCheckView } from '@/views/init/PresetImageCheck.view';
import { ResourceConfirmView } from '@/views/init/ResourceConfirm.view';
import { InitErrorPanelView } from '@/views/init/InitErrorPanel.view';

export function InitWizardContainer() {
  const w = useInitWizard();
  // ⚠️ 搬完之后**重跑检查链**，而不是由 hook 自行宣布就绪 —— 结论的唯一出处是诊断第 ⑧ 项。
  //    两个真相源会打架：hook 说成功了、检查链仍是红的，用户不知道该信谁。
  const provision = usePresetImageProvision(w.recheck);

  // 与 F21-5 诊断项的 [复制] 同一套（§5）。
  const copyFix = useCallback((command: string) => {
    void navigator.clipboard.writeText(command).then(
      () => {
        toast.success('已复制');
      },
      () => {
        // 静默失败会让用户去粘贴一段**上一次**复制的内容。
        toast.error('复制失败，请手动选中命令复制');
      },
    );
  }, []);

  const offline = w.connectivity.verdict === 'offline';
  // ⚠️ 离线时 [下一步] 需要用户先点过 [继续]（`OfflineNotice`）：那一下是 `acknowledgeOffline`
  //    的唯一来源，⛔ 前端不许替他填（否则一台真的连不上模型 API 的机器会静默通过初始化）。
  const nextBlockedByOffline = offline && !w.offlineAcknowledged;

  const shell = {
    steps: w.steps,
    ...(w.previousStep === undefined ? {} : { onBack: w.goBack }),
  };

  if (w.step === 'connectivity') {
    return (
      <InitWizardShellView
        {...shell}
        title="第 1 步 · 出网可达性"
        description="平台需要够得着模型 API（Agent 用）与镜像仓库（拉沙箱镜像用）。进向导直接显示上次检测的结果，不重跑一轮——需要最新结果时点 [重新检测]。"
        onNext={w.goNext}
        nextDisabled={nextBlockedByOffline}
        footerNote={nextBlockedByOffline ? '请先在上方确认「以离线模式继续」。' : undefined}
      >
        <ConnectivityCheckView
          model={w.connectivity}
          isChecking={w.isChecking}
          cooldownSec={w.recheckCooldownSec}
          onRecheck={w.recheck}
        />
        {offline ? (
          <OfflineNoticeView
            acknowledged={w.offlineAcknowledged}
            onContinue={w.acknowledgeOffline}
          />
        ) : null}
      </InitWizardShellView>
    );
  }

  if (w.step === 'proxy') {
    return (
      <InitWizardShellView
        {...shell}
        title="第 2 步 · 代理配置"
        description="上一步有目标不可达。内网环境通常需要配置代理；配好后点 [保存并重新检测]。"
        onNext={w.goNext}
        nextLabel="跳过，下一步"
        footerNote="保存只写配置，不会结束初始化。"
      >
        <ProxyConfigFormView
          // key 让设置回填到达后表单重新初始化（受控 state 的初值只吃第一次）。
          key={`${w.proxyInitial.httpProxy}|${w.proxyInitial.httpsProxy}|${w.proxyInitial.noProxy}`}
          initial={w.proxyInitial}
          isSaving={w.isSavingProxy}
          cooldownSec={w.recheckCooldownSec}
          errorMessage={w.proxyError}
          onSaveAndRecheck={w.saveProxyAndRecheck}
        />
        <ConnectivityCheckView
          model={w.connectivity}
          isChecking={w.isChecking}
          cooldownSec={w.recheckCooldownSec}
          onRecheck={w.recheck}
        />
        {offline ? (
          <OfflineNoticeView
            acknowledged={w.offlineAcknowledged}
            onContinue={w.acknowledgeOffline}
          />
        ) : null}
      </InitWizardShellView>
    );
  }

  if (w.step === 'preset-image') {
    return (
      <InitWizardShellView
        {...shell}
        title="第 3 步 · 沙箱镜像就绪"
        // ⚠️ 原文写「镜像体积（约 13GB）」—— 那是**本地 build 产物**的体积，
        //    而发布资产按档位是 0.43–2.07GB（P21-8 §2 前提②）。写死一个数会在两种
        //    部署里各错一次，⇒ 只说"它是下一步磁盘评估的最大一块"这个不变的事实。
        description="平台自建的沙箱镜像备齐了没有。这一步排在资源确认之前是刻意的：它依赖出网/代理，而镜像体积又是下一步磁盘评估的最大一块。"
        onNext={w.goNext}
        // ⚠️ **不阻塞**：未就绪也让走（§7A ③）。按钮上的字改成 [稍后配置，下一步]，
        //    后果由 footerNote 与卡片里的 ⚠️ 一起说清。
        nextLabel={w.presetImage.ready ? '下一步' : '稍后配置，下一步'}
        footerNote={
          w.presetImage.ready
            ? undefined
            : '⚠️ 跳过后平台能进、项目能建，但在镜像就绪之前无法发起任何任务。'
        }
      >
        <PresetImageCheckView
          model={w.presetImage}
          isChecking={w.isChecking}
          cooldownSec={w.recheckCooldownSec}
          onRecheck={w.recheck}
          onCopyFix={copyFix}
          onProvision={provision.start}
          isProvisioning={provision.isProvisioning}
          {...(provision.statusText === undefined
            ? {}
            : { provisionStatusText: provision.statusText })}
          {...(provision.error === undefined ? {} : { provisionError: provision.error })}
        />
      </InitWizardShellView>
    );
  }

  return (
    <InitWizardShellView
      {...shell}
      title="第 4 步 · 资源池确认"
      description="确认这台机器的资源规模。预留 15% 只影响调度上限，不影响水位进度条的分母。"
      // 最后一步的动作按钮在内容区里（[确认，开始使用]），壳上不再给 [下一步]。
    >
      <ResourceConfirmView
        model={w.resource}
        isError={w.resourceError}
        isFinishing={w.isFinishing}
        onFinish={w.finish}
      />
      {/* ⚠️ 失败**停在向导**，不放行（阻塞语义的另一半）。 */}
      {w.finishError === null ? null : (
        <InitErrorPanelView message={w.finishError} isRetrying={w.isFinishing} onRetry={w.finish} />
      )}
    </InitWizardShellView>
  );
}
