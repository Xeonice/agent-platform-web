// Step3「沙箱镜像就绪」的五项检查（F21-8 §7A · P21-5 §9A）。纯展示、props 驱动、零副作用。
//
// ⚠️ **三条纪律，全在这一屏上：**
//
//  ① **五步各渲染各的，⛔ 不许合成一个红灯。** 五步的下一步动作完全不同（改配置 / 推镜像 /
//     换成自建那张 / 重启平台 / 只是等一会），合成一句「镜像不可用」对五种情况一字不差，
//     而用户能做的事一个都不一样。⇒ 每一步一行，失败那一步带它**自己的**修复动作与命令。
//
//  ② **第 5 步渲染 ℹ️「提示」，⛔ 不是 ⚠️ 也不是 ❌。** 它是完全正常的状态：
//     镜像备齐了，只是还没下载到本机，首个任务要多等几分钟。渲染成警告会让用户去"修"一个
//     不需要修的东西——而他能想到的修法是删了重推，那会让情况更糟。
//     ⇒ 下面这张表里 `info` 与 `fail` 是**两行**，谁把它们合并谁当场改到这里。
//
//  ③ **[稍后配置] 放行了，但「在此之前无法发起任何任务」必须写在按钮旁边。** 这是整个向导里
//     唯一一处「放行了但功能不可用」——其余步骤放行后功能都是可用的。这句话不说，用户会在
//     最挫败的时机发现：建好项目、选完运行时、填完指令、点下 [发起] 的那一刻。
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import type { PresetImageChainModel, PresetImageStepState } from '@/types/init';

/** ⚠️ ② `info` 与 `fail` 分开、`pending`（没检查到）与 `fail` 也分开。 */
const STATE_TEXT: Readonly<Record<PresetImageStepState, string>> = {
  pass: '通过',
  // ⚠️ 「提示」不是「警告」：`info` 是"没有任何东西需要修"。
  info: '提示',
  fail: '未通过',
  // ⚠️ 链在前面就停了，后面几步**没有被检查**——不是"失败了"。
  pending: '未检查',
};

/**
 * 检查中的步骤用 pending；整轮已停止且未检查到的步骤用 unknown。
 * 未覆盖到的结论不等于失败，也不应继续表现为检查中。
 */
function statusPillStatusFor(state: PresetImageStepState, isChecking: boolean): StatusPillStatus {
  if (state === 'pass') return 'ok';
  if (state === 'info') return 'info';
  if (state === 'fail') return 'fail';
  return isChecking ? 'pending' : 'unknown';
}

export interface PresetImageCheckProps {
  model: PresetImageChainModel;
  isChecking: boolean;
  cooldownSec: number;
  onRecheck: () => void;
  onCopyFix: (command: string) => void;
  /** [准备镜像] —— 平台自己把字节搬到位。 */
  onProvision: () => void;
  isProvisioning: boolean;
  /** 当前阶段的一句话（`plan/fetch/verify/load/register`）。⛔ 失败在哪一步必须说得出。 */
  provisionStatusText?: string;
  provisionError?: string;
  /**
   * 当前帧的 0–1 进度，原样来自 `usePresetImageProvision`。`undefined` = 还没开始；
   * `null` = 这一帧给不出分母——⛔ **画不确定态，不画一个停在某处不动的假条**（那与
   * "卡死了"在观感上无法区分）。只在 `isProvisioning` 时渲染这一块。
   */
  provisionProgress?: number | null;
  /** 本次搬运已经跑了多少秒——真实挂钟时间，不是估算（同一份来源）。 */
  provisionElapsedSeconds?: number;
}

/** `1 分 39 秒` 这种口语化时长——与 `s.provision.sizeBytes` 那处内联换算同一惯例（本文件只做展示）。 */
function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${String(minutes)} 分 ${String(seconds)} 秒` : `${String(seconds)} 秒`;
}

export function PresetImageCheckView({
  model,
  isChecking,
  cooldownSec,
  onRecheck,
  onCopyFix,
  onProvision,
  isProvisioning,
  provisionStatusText,
  provisionError,
  provisionProgress,
  provisionElapsedSeconds,
}: PresetImageCheckProps) {
  const cooling = cooldownSec > 0;
  return (
    <section
      data-testid="preset-image-check"
      data-ready={model.ready ? 'true' : 'false'}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          镜像检查共 5 项，任一项未通过即止 —— 每一项的修复动作都不一样。
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isChecking || cooling}
          onClick={onRecheck}
        >
          {isChecking ? '检测中…' : cooling ? `重新检测（${String(cooldownSec)}s）` : '重新检测'}
        </Button>
      </div>

      {model.abortedText === undefined ? null : (
        <p
          role="alert"
          data-testid="preset-image-aborted"
          className="flex items-start gap-1.5 text-sm text-red-500"
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 translate-y-0.5" />
          <span>{model.abortedText}</span>
        </p>
      )}

      <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {model.steps.map((s) => (
          <li
            key={s.step}
            data-testid={`preset-step-${s.step}`}
            data-state={s.state}
            className="flex flex-col gap-2 px-4 py-3 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill
                status={statusPillStatusFor(
                  s.state,
                  isChecking && model.steps.every((step) => step.state === 'pending'),
                )}
              >
                {model.steps.every((step) => step.state === 'pending') &&
                isChecking &&
                s.state === 'pending'
                  ? '检查中…'
                  : STATE_TEXT[s.state]}
              </StatusPill>
              <span className="font-medium">
                第 {String(s.ordinal)} 项（共 {String(model.steps.length)} 项） · {s.label}
              </span>
            </span>

            {s.summary === undefined ? null : (
              <span className="whitespace-pre-wrap break-words">{s.summary}</span>
            )}

            {/* 第二层：证据 / 例外条款 / 为什么。⛔ 与结论分行、弱化，不许并成一句。 */}
            {s.detail === undefined ? null : (
              <span
                data-testid={`preset-step-detail-${s.step}`}
                className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
              >
                {s.detail}
              </span>
            )}

            {/* ① 这一步**自己的**下一步动作。⛔ 不许抽成一句五步通用的话。 */}
            {s.action === undefined ? null : (
              <span
                data-testid={`preset-step-action-${s.step}`}
                className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
              >
                {s.action}
              </span>
            )}

            {/* ⛔ 平台自己能搬时给按钮，**不给命令**（P21-8 §2 ⇒ 新判据）。
                此前这里无论如何都渲染 `fixCommand`，而那条命令的第一半是
                `docker build` —— 让用户重新构建一遍字节已经在本机的东西。 */}
            {s.provision === undefined ? null : (
              <span
                data-testid={`preset-step-provision-${s.step}`}
                // 预制镜像搬运提示与诊断信息共用 --info token，避免硬编码颜色漂移。
                className="flex flex-col gap-2 rounded-md border border-[hsl(var(--info)/0.3)] bg-[hsl(var(--info)/0.06)] p-2"
              >
                <span className="text-xs text-muted-foreground">{s.provision.why}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isProvisioning}
                    onClick={onProvision}
                    data-testid="preset-provision-button"
                  >
                    {isProvisioning ? '准备中…' : '准备镜像'}
                  </Button>
                  {/* ⚠️ **按之前就把代价说清**：搬多少、从哪到哪。给不出体积时只说来源，
                      ⛔ 不写「0 MB」——那是撒谎。 */}
                  <span className="text-xs text-muted-foreground">
                    {s.provision.from} → {s.provision.to}
                    {s.provision.sizeBytes === null
                      ? ''
                      : ` · 约 ${String(Math.round(s.provision.sizeBytes / 1024 / 1024))} MB`}
                  </span>
                </span>
                {/* 只在真实 provision 运行时显示进度与挂钟用时，两者独立计算。 */}
                {isProvisioning ? (
                  <span data-testid="preset-provision-progress" className="flex flex-col gap-1">
                    {provisionProgress === null || provisionProgress === undefined ? (
                      <span className="text-xs text-muted-foreground">
                        {/* ⛔ 给不出分母就不画百分比/进度条——一个停在原地不动的假条比什么都
                            不画更像"卡死了"。 */}
                        进度未知（后端这一帧给不出分母）——期间数字没变不代表卡死，正在持续写入。
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center gap-3">
                          <Progress
                            className="flex-1"
                            value={Math.round(provisionProgress * 100)}
                          />
                          <span
                            data-testid="preset-provision-percent"
                            className="text-xs tabular-nums text-muted-foreground"
                          >
                            {String(Math.round(provisionProgress * 100))}%
                          </span>
                        </span>
                      </>
                    )}
                    {provisionElapsedSeconds === undefined ? null : (
                      <span
                        data-testid="preset-provision-elapsed"
                        className="text-xs text-muted-foreground"
                      >
                        已用时 {formatElapsed(provisionElapsedSeconds)}
                      </span>
                    )}
                  </span>
                ) : null}
                {provisionStatusText === undefined ? null : (
                  <span
                    data-testid="preset-provision-status"
                    className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
                  >
                    {provisionStatusText}
                  </span>
                )}
                {provisionError === undefined ? null : (
                  <span className="flex flex-col gap-1">
                    <span
                      role="alert"
                      data-testid="preset-provision-error"
                      className="flex items-start gap-1 whitespace-pre-wrap break-words text-xs text-red-500"
                    >
                      <X aria-hidden="true" className="h-3 w-3 shrink-0 translate-y-0.5" />
                      <span>{provisionError}</span>
                    </span>
                    {/* ⛔ **不许只报错不给出路**（P22 §1）。这一整段原本只是把 registry 的
                        原文上屏 —— 用户读完知道"失败了"，但不知道**下一步做什么**。
                        ⚠️ 这条路上最常见的成因是**网络够得着但太慢**：2026-09-14 真机实测
                        ghcr.io 1.4 秒应答（联网检查因此全绿）而带宽只有 200 KB/s，
                        320 MB 的镜像拉到 84% 断掉。⇒ 把「去配代理」直接放在错误旁边。
                        ⚠️ 措辞是**建议**不是断言：我们并不知道这次一定是网速问题
                        （也可能是上游挂了），⛔ 不许把猜测说成结论。 */}
                    <span
                      data-testid="preset-provision-error-hint"
                      className="text-xs text-muted-foreground"
                    >
                      多半是网速：镜像下载源够得着、但拉得太慢，中途就断了。 换个网络环境后再点
                      [准备镜像] 重试；也可以先点 [下一步]，初始化完成后在「镜像管理」里再下载。
                    </span>
                  </span>
                )}
              </span>
            )}

            {s.fixCommand === undefined ? null : (
              <span className="flex flex-wrap items-center gap-2">
                <code className="flex-1 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-xs">
                  {s.fixCommand}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onCopyFix(s.fixCommand ?? '');
                  }}
                >
                  复制
                </Button>
              </span>
            )}
            {s.errorCode === undefined ? null : (
              <span
                data-testid={`preset-step-code-${s.step}`}
                className="text-xs text-muted-foreground"
              >
                错误码 {s.errorCode}
              </span>
            )}
          </li>
        ))}
      </ol>

      {/* ③ 唯一一处「放行了但功能不可用」。 */}
      {model.blockedText === undefined ? null : (
        <p
          role="alert"
          id="preset-image-blocked"
          data-testid="preset-image-blocked"
          className="flex items-start gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm text-amber-600"
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 translate-y-0.5" />
          <span>{model.blockedText}</span>
        </p>
      )}
    </section>
  );
}
