// File System Access API 的测试替身（S6 收尾 ③：产物流式落盘）。
//
// 为什么需要它：jsdom **没有** `showSaveFilePicker`，所以"回退到 blob"那条路是默认被测到的，
// 而流式落盘那条必须自己注入一个替身才跑得到。放在 mocks/ 而不是某个 test 文件里，
// 是因为 hook 单测与容器集成测试都要用同一套替身（两处各抄一份就会各自漂移）。
//
// 替身**不做任何类型断言**：`FakeWritableFile` 直接继承真的 `WritableStream` 并补齐
// `FileSystemWritableFileStream` 缺的三个方法，因此在类型上就是一个合法的写入流。

/** 记录写入的每一片。`closed` 为真才代表"这个文件真的落盘了"。 */
export class FakeWritableFile extends WritableStream implements FileSystemWritableFileStream {
  readonly chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;

  override close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  override abort(): Promise<void> {
    this.aborted = true;
    return Promise.resolve();
  }
  write(data: FileSystemWriteChunkType): Promise<void> {
    if (data instanceof Uint8Array) this.chunks.push(data);
    return Promise.resolve();
  }
  seek(): Promise<void> {
    return Promise.resolve();
  }
  truncate(): Promise<void> {
    return Promise.resolve();
  }

  /** 已写入的总字节数（断言"内容确实一片片落到盘上"）。 */
  get writtenBytes(): number {
    return this.chunks.reduce((n, c) => n + c.byteLength, 0);
  }
}

export class FakeFileHandle implements FileSystemFileHandle {
  readonly kind = 'file';
  constructor(
    readonly name: string,
    readonly writable: FakeWritableFile,
  ) {}
  createWritable(): Promise<FileSystemWritableFileStream> {
    return Promise.resolve(this.writable);
  }
  getFile(): Promise<File> {
    return Promise.reject(new Error('本替身不实现 getFile'));
  }
  isSameEntry(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export interface InstalledSaveFilePicker {
  /** 每次「打开存盘对话框」的入参（可断言 suggestedName）。 */
  readonly calls: { suggestedName?: string }[];
  readonly writable: FakeWritableFile;
}

/**
 * 往 `window` 上装一个存盘对话框替身。`reject` 传入时模拟"用户取消 / 存盘失败"。
 * ⚠️ 用完要 `Reflect.deleteProperty(window, 'showSaveFilePicker')`，否则会漏给下一个用例。
 */
export function installSaveFilePicker(options: { reject?: Error } = {}): InstalledSaveFilePicker {
  const writable = new FakeWritableFile();
  const calls: { suggestedName?: string }[] = [];
  window.showSaveFilePicker = (opts) => {
    calls.push({
      ...(opts?.suggestedName === undefined ? {} : { suggestedName: opts.suggestedName }),
    });
    if (options.reject !== undefined) return Promise.reject(options.reject);
    return Promise.resolve(new FakeFileHandle(opts?.suggestedName ?? 'artifact', writable));
  };
  return { calls, writable };
}

/** 用户在存盘对话框上点了取消时浏览器抛的那个错。 */
export function abortError(): Error {
  const err = new Error('The user aborted a request.');
  err.name = 'AbortError';
  return err;
}
