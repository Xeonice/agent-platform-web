// File System Access API 的**最小**子集（产物流式落盘用，S6 收尾 ③）。
//
// 为什么要自己声明：`FileSystemFileHandle` / `FileSystemWritableFileStream` 已经在 lib.dom 里，
// 但**入口 `window.showSaveFilePicker` 至今不在**（TS 5.9 实测仍无）。只补这一个入口，
// 其余形状直接复用 lib.dom 的官方类型 —— 不自己另造一套平行定义，免得两边漂移。
//
// ⚠️ 它是**可选**的：Safari / 老 Chromium / 非安全上下文都没有这个方法，
// 所以类型上就写成 `?:`，逼调用点必须显式处理"没有"的分支（回退 blob 存盘）。

/** `showSaveFilePicker` 的入参（只声明我们用到的那个字段）。 */
export interface SaveFilePickerOptions {
  /** 存盘对话框里的默认文件名。 */
  suggestedName?: string;
}

export type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;

declare global {
  interface Window {
    /**
     * 让用户选一个落盘位置并拿到可写句柄（需要用户手势 + 安全上下文）。
     * 不支持的浏览器上是 `undefined` —— 这正是回退路径的判据。
     */
    showSaveFilePicker?: ShowSaveFilePicker;
  }
}
