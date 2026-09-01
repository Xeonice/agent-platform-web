// 删除项目的二次确认（F21-6 §3 / §10.2 B）：级联后果文案 + **运行中任务警示**。
// 纯展示、props 驱动、零副作用。
//
// ⚠️ 与 F21-1 的 `DestroyTaskDialog` **是两个组件**（前者级联整个项目、后者含保留卷勾选），
// §3 已有此约定，⛔ 实现时不要合并。
//
// ⚠️ **它不是第二层 overlay**（与 §10.5「共用二次确认骨架 `ConfirmDialog.view`」的偏离，
// 已回填文档）：`ConfirmDialog.view` 自带 `fixed inset-0 z-50`，叠在 `ModalShell` 之上就是
// 两层弹层——而 P20 §8.4 / F21-6 §2 明写 modal 不堆叠（Esc 会变成"退哪一层"的猜谜）。
// 这里保留的是那个骨架的**形状**（标题 + 后果说明 + [取消]/[确认] 一行），
// 就地渲染在 `ProjectMenuPanel` 内，是**视图切换**而不是新弹层。
//
// ⚠️ 三段文案各自回答一个不同的问题，⛔ 不许合并成一句：
//   ① 级联：删掉的不只是项目本身；
//   ② 运行中任务：现在按下去会打断什么（**读真数据**，0 也照说，§10.6 第 3 条）；
//   ③ cloning：删除会先取消克隆再删——而「只取消克隆、保留项目」是**另一个动作**。
import { Button } from '@/components/ui/button';

export interface DeleteProjectConfirmProps {
  projectName: string;
  /** 该项目下的 Task 总数（后端权威 `taskCount`）。 */
  taskCount: number;
  /**
   * **正在运行**的 Task 数，来自沙箱列表实际状态（`countRunningTasks`）。
   * ⛔ 不接受"未知"：没有这个数就没有这条警示，而不是退回一句永远正确的空话。
   */
  runningTaskCount: number;
  /** 该项目正处于 `cloning`：删除是**两步**（先取消克隆，再删项目）。 */
  cloning: boolean;
  busy?: boolean;
  /** 删除被后端拒绝时的原因（409 等）。有它就说明弹层**必须留在原地**。 */
  errorMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteProjectConfirmView({
  projectName,
  taskCount,
  runningTaskCount,
  cloning,
  busy = false,
  errorMessage,
  onConfirm,
  onCancel,
}: DeleteProjectConfirmProps) {
  return (
    <section data-testid="delete-project-confirm" className="flex flex-col gap-3 px-5 py-4">
      <h4 className="text-base font-semibold">删除项目「{projectName}」？</h4>

      <p className="text-sm text-muted-foreground" data-testid="delete-cascade-copy">
        将删除该项目下 {taskCount} 个 Task 及其数据卷（保留的成果卷除外），不可逆。
      </p>

      {/* ② 运行中任务：两个分支都说话——0 的时候沉默会让人以为"这次没检查"。 */}
      {runningTaskCount > 0 ? (
        <p role="alert" className="text-sm text-yellow-300" data-testid="delete-running-warning">
          含 {runningTaskCount} 个运行中任务将被强制停止。
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="delete-running-warning">
          当前没有运行中的任务。
        </p>
      )}

      {/* ③ cloning：删除会先取消克隆再删；「只取消克隆、保留项目」是菜单里的另一项。 */}
      {cloning && (
        <p className="text-sm text-muted-foreground" data-testid="delete-cloning-note">
          该项目正在克隆：删除会先取消克隆，再连同项目一起删掉。若你只想停下这次克隆、把项目
          留着，请改用菜单里的 [取消克隆（保留项目）]。
        </p>
      )}

      {errorMessage !== undefined && errorMessage !== '' && (
        <p role="alert" className="text-sm text-red-400" data-testid="delete-error">
          {errorMessage}
        </p>
      )}

      <div className="mt-1 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          data-testid="delete-cancel"
          onClick={() => {
            onCancel();
          }}
        >
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          data-testid="delete-confirm"
          className="bg-red-600 text-white hover:opacity-90"
          onClick={() => {
            onConfirm();
          }}
        >
          {busy ? '删除中…' : '删除项目'}
        </Button>
      </div>
    </section>
  );
}
