// 「当前为离线环境，Agent 将不可用」+ [继续]（F21-8 §3/§5 · P21-8 §1/§2）。
// 纯展示、props 驱动、零副作用。
//
// ⚠️ **[继续] 必须可点。** 离线**不阻断初始化**：平台其余功能（项目管理、凭证与镜像配置、
// 系统诊断）在离线环境下全都可用，而 air-gapped 部署本来就是产品支持的一档（P21-8 §1）。
// 把它做成"离线就不让装"，等于把一个受支持的部署形态堵死。
//
// ⚠️ **[继续] 是一次显式确认，不是一个纯前端的翻页。** 点下它之后，`POST /api/system/init`
// 才会带上 `acknowledgeOffline: true`；后端没有这个标记会回 409（`initialization.service.ts`）。
// 这道门的作用是保证"Agent 将不可用"这句话**被说出来过**——⛔ 前端不许替用户默认填上它。
//
// ⚠️ **那句话本身不在这个文件里。** 它由 container 以 `verdictText` 传进来，出处只有一个：
// `lib/system/connectivityVerdict.ts` 的 `VERDICT_TEXT.offline`（同一份也喂给全局离线横幅）。
// 上一版在这里**又抄了一遍**，于是同一句话有两份复制、并且都点名了 codex / claude code
// ——而 runtime 是开放注册表，那句点名在装了第三方 runtime 的平台上是错的。两份复制的代价
// 不是多几行字，而是**改一处、漏一处**：向导里说的和横幅里说的会分叉，说的却是同一件事。
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface OfflineNoticeProps {
  /**
   * 离线结论那句话（`ConnectivityCheckModel.verdictText`，verdict 为 `offline` 时）。
   * ⛔ 不要在本文件里造一句"更贴合本页"的替代文案 —— 见文件头。
   */
  verdictText: string;
  /** 已经点过 [继续]：改显示已确认态（⛔ 不消失——用户要能看见自己确认了什么）。 */
  acknowledged: boolean;
  onContinue: () => void;
}

export function OfflineNoticeView({ verdictText, acknowledged, onContinue }: OfflineNoticeProps) {
  return (
    <section
      data-testid="offline-notice"
      data-acknowledged={acknowledged ? 'true' : 'false'}
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-3 text-sm"
    >
      <p className="flex items-center gap-1.5 font-medium text-red-500">
        <X aria-hidden="true" className="h-4 w-4 shrink-0" />
        {verdictText}
      </p>
      {/* 只有这一句是本页独有的：它回答"那我现在装了，以后网通了怎么办"。 */}
      <p className="text-muted-foreground">网络恢复后无需重装，回系统状态页重新检测即可。</p>
      {acknowledged ? (
        <p
          data-testid="offline-acknowledged"
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 translate-y-0.5" />
          <span>
            已确认以离线模式继续 —— 完成初始化后，工作台会常驻一条离线横幅，
            发起任务的入口会置灰（只置灰、不隐藏）。
          </span>
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onContinue}>
            我知道，继续
          </Button>
          <span className="text-xs text-muted-foreground">
            点它表示你确认在这台机器上 Agent 不可用，仍要完成初始化。
          </span>
        </div>
      )}
    </section>
  );
}
