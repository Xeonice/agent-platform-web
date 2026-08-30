// Step3「沙箱镜像就绪」的五步链（F21-8 §7A · P21-5 §9A）。纯展示、props 驱动、零副作用。
//
// ⚠️ **三条纪律，全在这一屏上：**
//
//  ① **五步各渲染各的，⛔ 不许合成一个红灯。** 五步的下一步动作完全不同（改配置 / 推镜像 /
//     换成自建那张 / 重启平台 / 只是等一会），合成一句「镜像不可用」对五种情况一字不差，
//     而用户能做的事一个都不一样。⇒ 每一步一行，失败那一步带它**自己的**修复动作与命令。
//
//  ② **第 5 步 `staged` 渲染 ℹ️「提示」，⛔ 不是 ⚠️ 也不是 ❌。** 它是完全正常的状态：
//     镜像备齐了，只是本机还没铺开，首个任务要多等几分钟。渲染成警告会让用户去"修"一个
//     不需要修的东西——而他能想到的修法是删了重推，那会让情况更糟。
//     ⇒ 下面这张表里 `info` 与 `fail` 是**两行**，谁把它们合并谁当场改到这里。
//
//  ③ **[稍后配置] 放行了，但「在此之前无法发起任何任务」必须写在按钮旁边。** 这是整个向导里
//     唯一一处「放行了但功能不可用」——其余步骤放行后功能都是可用的。这句话不说，用户会在
//     最挫败的时机发现：建好项目、选完运行时、填完指令、点下 [发起] 的那一刻。
import { Button } from '@/components/ui/button';
import type { PresetImageChainModel, PresetImageStepState } from '@/types/init';

/** ⚠️ ② `info` 与 `fail` 分开、`pending`（没检查到）与 `fail` 也分开。 */
const STATE_ICON: Readonly<Record<PresetImageStepState, string>> = {
  pass: '✅',
  info: 'ℹ️',
  fail: '❌',
  pending: '⏸',
};
const STATE_TEXT: Readonly<Record<PresetImageStepState, string>> = {
  pass: '通过',
  // ⚠️ 「提示」不是「警告」：`info` 是"没有任何东西需要修"。
  info: '提示',
  fail: '未通过',
  // ⚠️ 链在前面就停了，后面几步**没有被检查**——不是"失败了"。
  pending: '未检查',
};

export interface PresetImageCheckProps {
  model: PresetImageChainModel;
  isChecking: boolean;
  cooldownSec: number;
  onRecheck: () => void;
  onCopyFix: (command: string) => void;
}

export function PresetImageCheckView({
  model,
  isChecking,
  cooldownSec,
  onRecheck,
  onCopyFix,
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
          检查链共 5 步，任一步未通过即止 —— 每一步的修复动作都不一样。
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
              <span aria-hidden="true">
                {isChecking && s.state === 'pending' ? '⏳' : STATE_ICON[s.state]}
              </span>
              <span className="font-medium">
                检查链第 {String(s.ordinal)} 步 · {s.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {isChecking && s.state === 'pending' ? '检查中…' : STATE_TEXT[s.state]}
              </span>
            </span>

            {s.summary === undefined ? null : (
              <span className="whitespace-pre-wrap break-words">{s.summary}</span>
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
