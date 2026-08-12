// 终端输出 rAF 批量合并（08 §6.1）。纯逻辑 + 可注入调度器，便于单测（12 §3.2）。

const DEFAULT_FLUSH_BYTES = 256 * 1024; // 单批上限，超过立刻 flush，不等下一帧

type Scheduler = (cb: () => void) => number;
type Canceller = (handle: number) => void;

export interface WriteBatcherOptions {
  /** 将合并后的字符串写入终端实例。 */
  write: (merged: string) => void;
  /** 默认 requestAnimationFrame；测试注入同步/受控调度器。 */
  schedule?: Scheduler;
  cancel?: Canceller;
  /** 单批字节上限，达到即刻 flush。 */
  maxBytes?: number;
}

/**
 * 累积 push 的片段，在下一帧（rAF）合并成一次 write；
 * 超过 maxBytes 立即 flush；dispose 前必须 flushAndCancel（08 §6.1）。
 */
export class WriteBatcher {
  private buffer: string[] = [];
  private bufferedBytes = 0;
  private handle: number | null = null;
  private readonly write: (merged: string) => void;
  private readonly schedule: Scheduler;
  private readonly cancel: Canceller;
  private readonly maxBytes: number;

  constructor(opts: WriteBatcherOptions) {
    this.write = opts.write;
    this.maxBytes = opts.maxBytes ?? DEFAULT_FLUSH_BYTES;
    // 默认 rAF（浏览器/jsdom 均有）；非浏览器环境由调用方注入 schedule/cancel。
    this.schedule = opts.schedule ?? ((cb) => requestAnimationFrame(cb));
    this.cancel =
      opts.cancel ??
      ((h) => {
        cancelAnimationFrame(h);
      });
  }

  push(chunk: string): void {
    if (chunk.length === 0) return;
    this.buffer.push(chunk);
    this.bufferedBytes += chunk.length;
    if (this.bufferedBytes >= this.maxBytes) {
      this.flush();
      return;
    }
    this.handle ??= this.schedule(() => {
      this.flush();
    });
  }

  flush(): void {
    if (this.handle !== null) {
      this.cancel(this.handle);
      this.handle = null;
    }
    if (this.buffer.length === 0) return;
    const merged = this.buffer.join('');
    this.buffer = [];
    this.bufferedBytes = 0;
    this.write(merged);
  }

  /** dispose 前调用：flush 残留并取消未触发的 rAF，防回调写入已销毁实例（08 §6.1）。 */
  flushAndCancel(): void {
    this.flush();
    if (this.handle !== null) {
      this.cancel(this.handle);
      this.handle = null;
    }
  }

  get pendingBytes(): number {
    return this.bufferedBytes;
  }
}
