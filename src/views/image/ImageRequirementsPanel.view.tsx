// 「平台对镜像的要求」常驻面板（P21-4 §5/§9 的 [查看镜像要求] 出路）。纯展示、props 驱动、零副作用。
//
// ⛔ **它此前是一个 toast，那是形态错了。** 这是用户**改 Dockerfile 时对照着看**的清单，
//    四条看一眼记不住，而 toast 4 秒就没了。⇒ 常驻侧栏，用户自己关。
//
// ⚠️ **四条要与后端真正在判的东西逐条对得上**，否则用户照着改完还是过不了：
//   ① `IMAGE_BASE_REQUIRED`（`image-application.service.ts#lineageVerdict`）—— 注册期，按
//      **镜像层**（`rootfs.diff_ids`）比对，所以改标签、改名一律不算数；
//   ② `IMAGE_ENTRYPOINT_INVALID`（`oci-image-spec.provider.ts#validate`）；
//   ③ tmux —— **注册期不判**。那条标签检查 2026-08 被删了，理由是**标签会被派生镜像继承**：
//      一张 `RUN rm /usr/bin/tmux` 的镜像照样在声明 `platform.tmux=true`。判定改到运行期
//      实测（`command -v tmux` ⇒ `IMAGE_CONTRACT_VIOLATION`）。
//      ⛔ 所以这一条**不能写成「必须声明 label `platform.tmux=true`」**：照着打这个标签的人
//      注册照样被拒，而他以为自己合规了。正确的话是「你什么都不用做，但别删掉它」。
//   ④ `RUNTIME_NOT_PREINSTALLED` —— warning，**不阻断注册**。
//
// ⛔ **不许在这里写耗时数字。** 现装 CLI 的耗时按沙箱环境差一个数量级（「实测约 12.5 分钟」
//    是 aio 那一档的数字），而这一页拿不到当前是哪一档 ⇒ 只说"会明显变慢"。
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 一条要求：标题 + 展开说明 + 是否会**拦住注册**。 */
interface Requirement {
  id: string;
  /** 会不会拦住注册。⚠️ 这一列必须如实：把"只是提醒"写成"必须"，用户会去做无用功。 */
  blocking: boolean;
  title: string;
  body: string;
}

const REQUIREMENTS: readonly Requirement[] = [
  {
    id: 'lineage',
    blocking: true,
    title: '① 必须从平台的预制镜像改起',
    body:
      'Dockerfile 的第一行要 FROM 平台预制镜像（或它的派生）。平台比对的是镜像内容本身（镜像层），' +
      '所以加标签、改名、重新打一个 tag 都不算数 —— 内容对不上就会被拒。' +
      '被拒时错误里会列出当前可用的预制镜像坐标，照着改就行。',
  },
  {
    id: 'entrypoint',
    blocking: true,
    title: '② 必须有启动命令与工作目录',
    body:
      '镜像要有 Entrypoint 或 Cmd（两者有其一即可），并且要有 WorkingDir。' +
      '少了启动命令，平台不知道怎么把它跑起来；少了工作目录，代码不知道该放哪儿。',
  },
  {
    id: 'tmux',
    blocking: false,
    title: '③ tmux：你不用做什么，但别删掉它',
    body:
      '预制镜像里已经装好了 tmux，你的镜像从它改起就自然带着。注册时平台不检查它' +
      '（镜像标签会被派生镜像继承，所以标签说了不算）。' +
      '但如果你在自己的镜像里把它删掉了，任务真正启动时会当场失败 —— Agent 会话由沙箱里的 tmux 持有，' +
      '没有它，平台一重启就会丢掉正在跑的会话，因此不做静默降级。',
  },
  {
    id: 'preinstall',
    blocking: false,
    title: '④ 没预装 Agent CLI 只是提醒，不拦你',
    body:
      '镜像可以用 platform.supportedRuntimes 声明自己预装了哪些 Agent 的 CLI。没有声明照样能注册，' +
      '只会给一条 ⚠️ 提醒：那时 CLI 会在创建任务时现装，任务启动会明显变慢' +
      '（具体多久取决于这台机器的沙箱环境，这里不给一个会骗人的数字）。',
  },
];

export interface ImageRequirementsPanelProps {
  onClose: () => void;
}

export function ImageRequirementsPanelView({ onClose }: ImageRequirementsPanelProps) {
  return (
    <aside
      data-testid="image-requirements-panel"
      // ⚠️ **不是 `role="dialog"`**：它不阻塞、不抢焦点，注册弹窗开着时也要能对照着看。
      role="complementary"
      aria-label="平台对镜像的要求"
      className="fixed right-0 top-0 z-[60] flex h-full w-full max-w-md flex-col gap-3 overflow-y-auto border-l border-border bg-background p-5 shadow-xl"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-1.5 text-base font-semibold">
            <ClipboardList aria-hidden="true" className="h-4 w-4" />
            平台对镜像的要求
          </h3>
          <p className="text-xs text-muted-foreground">
            前两条不满足会 <strong className="font-medium text-foreground">拦住注册</strong>
            ，后两条不会。这个面板不会自动关掉 —— 改 Dockerfile 时可以一直开着对照。
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      </header>

      <ol className="flex flex-col gap-3">
        {REQUIREMENTS.map((r) => (
          <li
            key={r.id}
            data-testid={`image-requirement-${r.id}`}
            data-blocking={String(r.blocking)}
            className="flex flex-col gap-1 rounded-md border border-border/60 p-3 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.title}</span>
              {/* 「会不会拦住你」是这张清单上最要紧的一列，所以它是文字标签而不是只有颜色。 */}
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {r.blocking ? '不满足会被拒绝注册' : '只是提醒，不拦你'}
              </span>
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">{r.body}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
