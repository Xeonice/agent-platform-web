export function projectSyncFailure(code?: string): { message: string; needsCredentials: boolean } {
  const messages: Record<string, string> = {
    CLONE_FAILED_PERMISSION:
      '远端拒绝了这次访问：凭证无效或没有这个仓库的权限。配置 Git 访问凭证后再点「拉取最新代码」。',
    CLONE_FAILED_NOT_FOUND:
      '打不开这个仓库：可能是 Git 凭证失效了，也可能是远端仓库已经改名、删掉或不再对你开放。',
    CLONE_FAILED_NETWORK: '网络不通，没拉下来。检查网络后再点「拉取最新代码」。',
    INTERRUPTED: '拉取被中断了，再点一次「拉取最新代码」。',
    TIMEOUT: '5 分钟内没拉完（仓库较大或网络较慢），再点一次试试。',
    DISK_INSUFFICIENT: '磁盘空间不足，没拉下来。清理出空间后再拉。',
    INVALID_STATE: '这个项目现在不能拉取最新代码，请刷新项目信息再试。',
  };
  return {
    message: code
      ? (messages[code] ?? '没能拉取最新代码，请稍后再试。')
      : '网络不通，没拉下来。检查网络后再点「拉取最新代码」。',
    needsCredentials: code === 'CLONE_FAILED_PERMISSION' || code === 'CLONE_FAILED_NOT_FOUND',
  };
}
