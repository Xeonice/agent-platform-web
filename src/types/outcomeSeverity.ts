// 结果文案的语义严重度：lib 只返回状态，不返回图标组件或在标题中嵌入图标。
// 调用方按场景选择 OutcomeIcon 或 StatusPill；本类型由 lib/component/view 共同依赖。
export type OutcomeSeverity = 'ok' | 'info' | 'warn' | 'fail' | 'timeout';
