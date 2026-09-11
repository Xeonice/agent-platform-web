// 终端顶部内嵌条：重连黄条 / 连接超时 / 协议漂移（08 §11.6）。纯展示，props 驱动，零副作用。
import type { ConnState } from '@/types/terminal';

export interface ConnectionStatusProps {
  connState: ConnState;
  attempt?: number;
  /**
   * 退避耗尽（`connState==='closed'`）后的唯一出路。
   *
   * ⚠️ **必填，刻意的**。此前它是可选的、而 TerminalMount 一直没接线 ⇒ 界面上那个「手动重连」
   * 是个死按钮（点了没反应，比没有按钮更糟）。改必填后，"渲染了终端连接条却没给出路"这件事
   * 由 tsc 在编译期挡住，而不是靠人记得接线——view 层没有别的手段能防住它。
   */
  onManualReconnect: () => void;
  /**
   * 握手被拒的人话（非未授权那一类，如版本漂移）。非空时**接管整条状态条**。
   *
   * ⚠️ 为什么必须接管而不是叠加一行：这一类失败是确定性的，「手动重连」按不通。
   * 把它和"连接超时，手动重连"并排放，等于同时给出一条真出路和一条假出路，
   * 而用户只会去按那个按钮——那正是终端上刚修掉的死按钮的同一种病，换了个来源。
   */
  handshakeErrorMessage?: string;
  /**
   * 会话已经结束（后端发来 `exit` 帧）。非空时同样**接管整条状态条**。
   *
   * ⚠️ 与握手拒绝同一类问题、同一种处置：结束了的会话再连多少次都是同一个结果。
   * 此前后端在 `openSession` 失败时是**一声不吭地挂断**,客户端无从区分"会话没了"
   * 和"网络抖了一下",只能按抖动重试——烧完 9 次退避约 2 分钟,然后那个「手动重连」
   * 每按一次又清零预算重来一轮,用户看到的就是"无限重连"。
   */
  sessionEndedMessage?: string;
}

export function ConnectionStatusView({
  connState,
  attempt = 0,
  onManualReconnect,
  handshakeErrorMessage,
  sessionEndedMessage,
}: ConnectionStatusProps) {
  // 会话已结束优先于一切连接态：原因已确定,不该再显示"正在重连…"，也不该给出
  // 一个按不通的「手动重连」（那正是死按钮的同一种病）。
  if (sessionEndedMessage !== undefined && sessionEndedMessage !== '') {
    return (
      <div
        role="alert"
        data-testid="terminal-session-ended"
        className="flex items-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300"
      >
        <span>{sessionEndedMessage}</span>
      </div>
    );
  }
  // 协议漂移优先于一切连接态：连不上的原因已经确定，别再显示"正在重连…"。
  if (handshakeErrorMessage !== undefined && handshakeErrorMessage !== '') {
    return (
      <div
        role="alert"
        data-testid="terminal-handshake-error"
        className="flex items-center gap-2 bg-red-500/15 px-3 py-1.5 text-xs text-red-300"
      >
        <span>{handshakeErrorMessage}</span>
      </div>
    );
  }

  if (connState === 'open') return null;

  if (connState === 'reconnecting') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 bg-yellow-500/15 px-3 py-1.5 text-xs text-yellow-300"
      >
        <span aria-hidden>●</span>
        {/* ⚠️ 用户此刻最想知道的不是"连了第几次"，而是"我的 agent 还在跑吗"。
            **断线重连确实恢复现场**（终端网关 attach 的是后端一直活着的那个会话），
            所以这一句可以这么说 —— 它与「回收后重启」是两件事，那一件⛔ 不许这么说。 */}
        <span>正在重连…（第 {attempt} 次）。任务在后台继续跑，不会因为这次断线中断。</span>
      </div>
    );
  }

  if (connState === 'closed') {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 bg-red-500/15 px-3 py-1.5 text-xs text-red-300"
      >
        {/* ⚠️ 两件事要分清，缺一条都会误导：
              · **重试次数用完 ≠ 证明连不上**（超时只说明这几次没连上，不是"不可达"）；
              · **任务本身没有因此停下** —— 断的只是这条看屏幕的连接，
                后端那个 agent 会话一直活着，重新连上就能接着看。 */}
        <span>
          自动重连的次数用完了，暂时停手。这只说明这几次没连上，不代表连不上；
          任务本身还在后台跑，重新连上就能接着看。
        </span>
        <button
          type="button"
          className="underline"
          onClick={() => {
            onManualReconnect();
          }}
        >
          手动重连
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground">
      连接中…
    </div>
  );
}
