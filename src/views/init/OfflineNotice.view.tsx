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
// ⚠️ 这里说的是**物理约束不是配置问题**：codex / claude code 必须能访问各自的模型 API。
// 写成"请检查网络设置"会让用户在一台确实没有外网的机器上一直找自己的错。
import { Button } from '@/components/ui/button';

export interface OfflineNoticeProps {
  /** 已经点过 [继续]：改显示已确认态（⛔ 不消失——用户要能看见自己确认了什么）。 */
  acknowledged: boolean;
  onContinue: () => void;
}

export function OfflineNoticeView({ acknowledged, onContinue }: OfflineNoticeProps) {
  return (
    <section
      data-testid="offline-notice"
      data-acknowledged={acknowledged ? 'true' : 'false'}
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-3 text-sm"
    >
      <p className="font-medium text-red-500">🔴 当前为离线环境，Agent 将不可用</p>
      <p className="text-muted-foreground">
        codex / claude code 必须能访问各自的模型 API —— 这是**物理约束，不是配置问题**，
        平台无法绕开。项目管理、凭证与镜像配置、系统诊断等其余功能**照常可用**；
        网络恢复后无需重装，回系统状态页重新检测即可。
      </p>
      {acknowledged ? (
        <p data-testid="offline-acknowledged" className="text-xs text-muted-foreground">
          ✅ 已确认以离线模式继续 —— 完成初始化后，工作台会常驻一条离线横幅，
          发起任务的入口会置灰（只置灰、不隐藏）。
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
