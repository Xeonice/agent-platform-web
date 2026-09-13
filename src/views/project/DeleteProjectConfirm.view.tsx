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
//   ① 级联三行：删什么 / 留什么 / 能不能反悔（见下面那段长注释）；
//   ② 运行中任务：现在按下去会打断什么（**读真数据**，0 也照说，§10.6 第 3 条）；
//   ③ cloning：删除会先取消克隆再删——而「只取消克隆、保留项目」是**另一个动作**。
import { Button } from '@/components/ui/button';

export interface DeleteProjectConfirmProps {
  projectName: string;
  /** 该项目下的任务总数（后端权威 `taskCount`）。 */
  taskCount: number;
  /**
   * **正在运行**的任务数，来自任务列表的实际状态（`countRunningTasks`）。
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

      {/*
        ★ **三行，⛔ 一条都不许省、也不许合并成一句。**

        旧文案是一句话：「将删除该项目下 5 个 Task 及其数据卷（保留的成果卷除外），不可逆。」
        它有三处具体的毛病，逐条对应下面三行：
          ① 最重要的「留了什么」被塞进了括号里 —— 而括号是人眼第一个跳过的地方；
          ② **一个字都没说远端 Git 仓库不受影响** —— 那恰恰是开发者按下去之前最想确认的
             第一件事。没说，用户就得自己去赌，或者干脆不敢删；
          ③ 「成果卷」是界面上别处没有的词，用户没法把它和菜单里那一项对上
             （全屏已统一为「保留下来的成果」，与 `ProjectMenuPanel.view` 的按钮逐字一致）。

        ⚠️ **「会留下」里刻意只写远端仓库这一件事。** 旧文案括号里那句「保留的成果卷除外」
           **在代码上是存疑的**：`retained_volumes.project_id` 的外键是 `onDelete:'restrict'`，
           而项目删除路径里没有任何一处清理它 ⇒ 项目下还有保留成果时，这次删除会被数据库
           直接拒掉，而不是"删项目、留成果"。语义未裁之前 ⛔ 不许在这里替它下结论 ——
           「不知道」不能说成「会留下」。这一条已列进交付报告等裁决。

        ⛔ 不许为"简洁"再压回一句：破坏性操作的后果必须说全，这三行各自回答一个
           用户真的会问的问题（删什么 / 留什么 / 能不能反悔）。
      */}
      <dl className="flex flex-col gap-1.5 text-sm" data-testid="delete-cascade-copy">
        <div>
          <dt className="text-xs text-muted-foreground">会删掉</dt>
          <dd>这个项目下的 {taskCount} 个任务，以及它们的工作目录。</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">会留下</dt>
          <dd>
            <strong className="font-medium">远端 Git 仓库不受影响</strong>
            —— 删掉的只是这台机器上的这份副本，仓库里的代码和提交历史一点没动。
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">删掉之后</dt>
          <dd>拿不回来。要再用这个仓库，只能重新建一个项目、重新克隆。</dd>
        </div>
      </dl>

      {/* ② 运行中任务：两个分支都说话——0 的时候沉默会让人以为"这次没检查"。 */}
      {runningTaskCount > 0 ? (
        <p role="alert" className="text-sm text-yellow-300" data-testid="delete-running-warning">
          其中 {runningTaskCount} 个任务正在跑，会被强制停下。
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="delete-running-warning">
          当前没有运行中的任务。
        </p>
      )}

      {/* ③ cloning：删除会先取消克隆再删；「只取消克隆、保留项目」是菜单里的另一项。 */}
      {cloning && (
        <p className="text-sm text-muted-foreground" data-testid="delete-cloning-note">
          这个项目正在克隆：删除会先停掉这次克隆，再把项目一起删掉。如果你只是想停下这次克隆、
          把项目留着，请改用菜单里的 [取消克隆（保留项目）]。
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
