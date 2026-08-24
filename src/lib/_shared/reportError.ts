// 错误/异常上报单一消费点（telemetry seam）。
// 目的：让 onInvalidFrame 等"生产上报端"有一个明确、可替换的落点，而不是散落 console 或静默吞掉。
// - dev：console.error（fail-fast，开发即见）。
// - prod：默认 no-op；接入 Sentry/自研上报时经 setErrorReporter 注入一个钩子即可，无需改调用点。

export type ReportContext = Record<string, unknown>;

/** 可替换的上报实现（生产接入监控时注入）。 */
export type ErrorReporter = (message: string, context?: ReportContext) => void;

let reporter: ErrorReporter | null = null;

/** 注入/清除生产上报实现（幂等；传 null 复位为 no-op）。 */
export function setErrorReporter(next: ErrorReporter | null): void {
  reporter = next;
}

/**
 * 全站唯一错误上报入口。dev 打印，prod 交由注入的 reporter；两端都不抛、不阻断渲染。
 * reporter 自身抛错被吞掉（上报失败绝不能连累主流程）。
 */
export function reportError(message: string, context?: ReportContext): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[reportError] ${message}`, context ?? {});
  }
  if (reporter !== null) {
    try {
      reporter(message, context);
    } catch {
      // 上报失败静默：监控管道不可用不应影响用户流程。
    }
  }
}
