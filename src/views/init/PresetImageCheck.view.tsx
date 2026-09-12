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
 * `PresetImageStepState` → `StatusPill` 八态。
 *
 * ⚠️ **`pending` 分两支**（design/design-notes.md §2）：正在整轮检查中的那些用会转的
 * `pending`（灰底 + loader）；链已经停下、这几步压根没被检查到的用 `unknown`（虚线灰边框，
 * 语义"无样本/未知，≠ 失败"）——两者的产品事实不同：前者"马上有结论"，后者"这一轮结论
 * 没有覆盖到这里"，⛔ 不能用同一个视觉表达两件不同的事。
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
        <p role="alert" data-testid="preset-image-aborted" className="text-sm text-red-500">
          ⚠️ {model.abortedText}
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {model.steps.map((s) => (
          <li
            key={s.step}
            data-testid={`preset-step-${s.step}`}
            data-state={s.state}
            className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill status={statusPillStatusFor(s.state, isChecking)}>
                {isChecking && s.state === 'pending' ? '检查中…' : STATE_TEXT[s.state]}
              </StatusPill>
              <span className="font-medium">
                第 {String(s.ordinal)} 步（共 {String(model.steps.length)} 步） · {s.label}
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

            {s.errorCode === undefined ? null : (
              <span
                data-testid={`preset-step-code-${s.step}`}
                className="text-xs text-muted-foreground"
              >
                错误码 {s.errorCode}
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
                className="flex flex-col gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2"
              >
                <span className="text-xs text-muted-foreground">{s.provision.why}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
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
                {/* ⚠️ **只在真的在跑时画这一块**——数据源是真实的 provision 事件流
                    （`usePresetImageProvision`），⛔ 不是原型里那个自转的 `setInterval` 演示。
                    进度百分比与已用时长是**两个独立的、各自跳动的数字**：字节分数长时间不变
                    时，仍在走的用时才是"没有卡死，正在写盘"的证据（design/design-notes.md
                    §1 问题 3）。 */}
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
                        <span
                          data-testid="preset-provision-percent"
                          className="font-mono text-sm font-medium"
                        >
                          {String(Math.round(provisionProgress * 100))}%
                        </span>
                        <Progress value={Math.round(provisionProgress * 100)} />
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
                  <span
                    role="alert"
                    data-testid="preset-provision-error"
                    className="whitespace-pre-wrap break-words text-xs text-red-500"
                  >
                    ❌ {provisionError}
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
          </li>
        ))}
      </ol>

      {/* ③ 唯一一处「放行了但功能不可用」。 */}
      {model.blockedText === undefined ? null : (
        <p
          role="alert"
          data-testid="preset-image-blocked"
          className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm text-amber-600"
        >
          ⚠️ {model.blockedText}
        </p>
      )}
    </section>
  );
}
