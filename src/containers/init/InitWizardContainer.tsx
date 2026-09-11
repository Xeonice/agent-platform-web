'use client';
// 初始化向导的容器（F21-8 §3）。**唯一的 view ↔ hook 粘合点**：取数、SSE 编排、mutation
// 全在 `useInitWizard`；判定、单位换算、文案挑选全在 `lib/system/`；这里只做步骤分发与回调接线。
//
// ⛔ **本容器刻意不接 `useEscapeKey`，也不提供任何 `onClose`/`onCancel`。**
//    这是全局 Esc 分层规则（P20 §8.4）的**唯一例外**（F21-8 §2 阻塞语义）：向导是放行卡点，
//    关掉它之后没有"回到哪里"—— `AppBootGate` 在 `initialized === false` 时压根不挂载工作台，
//    所以逃逸出去只会得到一张白屏。⇒ 谁要在这里加 Esc/取消，请先回答"关掉之后用户看到什么"。
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { notifyRuntimeAuthConfigured } from '@/hooks/credential/useRuntimeAuthMutations';
import { useInitWizard } from '@/hooks/system/useInitWizard';
import { usePresetImageProvision } from '@/hooks/system/usePresetImageProvision';
import { SubscriptionSetupView } from '@/views/init/SubscriptionSetup.view';
import { AuthGateContainer } from '@/containers/credential/AuthGateContainer';
import { InitWizardShellView } from '@/views/init/InitWizardShell.view';
import { ConnectivityCheckView } from '@/views/init/ConnectivityCheck.view';
import { ProxyConfigFormView } from '@/views/init/ProxyConfigForm.view';
import { OfflineNoticeView } from '@/views/init/OfflineNotice.view';
import { PresetImageCheckView } from '@/views/init/PresetImageCheck.view';
import { ResourceConfirmView } from '@/views/init/ResourceConfirm.view';
import { InitErrorPanelView } from '@/views/init/InitErrorPanel.view';

export function InitWizardContainer() {
  // 授权成功后要刷新 runtime 状态 —— 见下面 `onSuccess` 那段。
  const queryClient = useQueryClient();
  const w = useInitWizard();
  // ⚠️ 搬完之后**重跑检查链**，而不是由 hook 自行宣布就绪 —— 结论的唯一出处是诊断第 ⑧ 项。
  //    两个真相源会打架：hook 说成功了、检查链仍是红的，用户不知道该信谁。
  // ⚠️ **进第 3 步且平台自己搬得了 ⇒ 不等用户点，自己开始**（用户 2026-09-10 裁决）。
  //    只给按钮的话，按钮不点铺开照样被后置到第一个任务 —— 那正是被否掉的形态。
  //    判定在纯函数 `autoStageOffer` 里（container 够不着 lib，经 `w` 交出来）。
  const provision = usePresetImageProvision(w.recheck, w.step === 'preset-image' && w.autoStage);
  const [expandedRuntime, setExpandedRuntime] = useState<string | undefined>(undefined);

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
        title="第 1 步 · 联网检查"
        description="平台需要连得上模型 API（Agent 用）与镜像下载源（下载沙箱镜像用）。这里直接显示上次检查的结果，不重跑一轮——需要最新结果时点 [重新检测]。"
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
            // 离线那句话只有一份出处（`lib/system/connectivityVerdict.ts`）——
            // 全局离线横幅吃的也是这一份，view 里不再抄第二句。
            verdictText={w.connectivity.verdictText}
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
        description="上一步有目标连不上。内网环境通常需要配置代理；配好后点 [保存并重新检测]。"
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
            // 离线那句话只有一份出处（`lib/system/connectivityVerdict.ts`）——
            // 全局离线横幅吃的也是这一份，view 里不再抄第二句。
            verdictText={w.connectivity.verdictText}
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
        title="第 3 步 · 沙箱镜像"
        // ⚠️ 原文写「镜像体积（约 13GB）」—— 那是**本地 build 产物**的体积，
        //    而发布资产按沙箱环境是 0.43–2.07GB（P21-8 §2 前提②）。写死一个数会在两种
        //    部署里各错一次，⇒ 只说"它是下一步磁盘评估的最大一块"这个不变的事实。
        description="平台自己的沙箱镜像备齐了没有。这一步排在本机资源之前是刻意的：它要先能联网/走代理，而镜像体积又是下一步磁盘评估里最大的一块。"
        onNext={w.goNext}
        // ⚠️ **不阻塞**：未就绪也让走（§7A ③）。按钮上的字改成 [稍后配置，下一步]，
        //    后果由 footerNote 与卡片里的 ⚠️ 一起说清。
        nextLabel={w.presetImage.ready ? '下一步' : '稍后配置，下一步'}
        footerNote={
          w.presetImage.ready
            ? undefined
            : '⚠️ 跳过后平台能进、项目能建，但在镜像备齐之前无法发起任何任务。'
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

  if (w.step === 'subscription') {
    const model = w.subscription;
    return (
      <InitWizardShellView
        {...shell}
        title="第 4 步 · 模型帐号"
        description="Agent 用你自己的模型帐号跑。这一步排在最后一个准备项，是因为它是整个向导里唯一需要你离开本页去别处操作的一步 —— 而设备码只有 15 分钟。"
        onNext={w.goNext}
        // ⚠️ **不阻塞**（与 Step 3 同一条口径）：它们挡住的是同一件事——发起任务。
        nextLabel={model?.ready === true ? '下一步' : '稍后配置，下一步'}
        footerNote={
          model?.ready === true
            ? undefined
            : '⚠️ 跳过后平台能进、项目能建，但在配好至少一个模型帐号之前无法发起任何任务。'
        }
      >
        {w.subscriptionError ? (
          <p role="alert" className="text-sm text-red-500">
            读不到 Agent 列表 —— 无法判断凭证状态。可以先跳过，之后在凭证管理页配置。
          </p>
        ) : model === undefined ? (
          <p className="text-sm text-muted-foreground">正在读取 Agent 列表…</p>
        ) : (
          <SubscriptionSetupView
            model={model}
            {...(expandedRuntime === undefined ? {} : { expandedRuntimeId: expandedRuntime })}
            onExpand={setExpandedRuntime}
            onCollapse={() => {
              setExpandedRuntime(undefined);
            }}
            // ⛔ **同一个 `AuthGateContainer`**（F07 §6.1 第三处宿主）：两份「怎么算授权
            //    成功」迟早对不上，而其中一份还管着运行期的凭证过期判定。
            renderAuthPanel={(r) => (
              <AuthGateContainer
                runtimeId={r.id}
                runtimeName={r.displayName}
                methods={r.methods}
                apiKeyPrefix={r.apiKeyPrefix}
                onSuccess={() => {
                  // ⛔ **三件事，缺一件用户就看不到自己成功了**（2026-09-07 实测）。
                  //    此前这里**只做了收起面板**，而注释却写着「状态由 runtimeKeys.list
                  //    的 invalidate 驱动刷新」—— 那个 invalidate 根本不在这里。
                  //    真机结果：设备码授权成功、凭证已落库（后端 `CredentialStored`），
                  //    而界面上面板无声无息地关掉了，**没有任何「配置完成」的提示**，
                  //    行也不刷新。用户唯一能确认自己成功了的办法是刷新整个页面。
                  //
                  // ⚠️ 同一个代码库里就有对的那份（`useCredentials.ts` 的 `onAuthSuccess`）：
                  //    invalidate + 收起 + toast，三件齐全。两处宿主对「怎么算授权成功」
                  //    各写一遍，于是其中一份漏了两件事 —— 与 F07 §6.1 让两处共用同一个
                  //    `AuthGateContainer` 是同一条纪律，只是这一层没跟上。
                  notifyRuntimeAuthConfigured(queryClient, '凭证已配置');
                  setExpandedRuntime(undefined);
                }}
              />
            )}
          />
        )}
      </InitWizardShellView>
    );
  }

  return (
    <InitWizardShellView
      {...shell}
      title="第 5 步 · 本机资源"
      // ⛔ **这一句以前硬编码了「预留 15%」**，而同一屏的 `reservedText` 取的是后端下发的
      //    `dto.disk.reservedPercent` —— 后端一改这个值，标题这句当场变成假话。
      //    ⇒ 这里根本不该出现具体百分比，具体数字由下方那一行如实说。
      description="确认这台机器的资源规模。平台会留出一部分容量不拿去跑任务（具体比例见下方），进度条的分母仍然是总容量。"
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
