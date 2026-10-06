import type { ValidationIssueDto } from '@/types/image';

export const KNOWN_IMAGE_ISSUE_CODES = new Set([
  'IMAGE_BASE_REQUIRED',
  'IMAGE_ENTRYPOINT_INVALID',
  'RUNTIME_NOT_PREINSTALLED',
]);

/** 镜像判定按码取句子，下载源与 CLI 名来自已知上下文，后端自由文本不上屏。 */
export function imageIssueCopy(
  issue: Pick<ValidationIssueDto, 'code' | 'path'> & { message?: string },
  anchors: readonly string[] = [],
): string {
  if (issue.code === 'IMAGE_BASE_REQUIRED')
    return `自定义镜像必须从平台预制镜像改起${anchors.length === 0 ? '；可用坐标见预制镜像卡' : `：Dockerfile 使用 FROM ${anchors.join(' 或 ')}`}。改标签、改名都不算数。`;
  if (issue.code === 'IMAGE_ENTRYPOINT_INVALID')
    return issue.path === 'workingDir'
      ? '镜像的工作目录不能是空字符串。'
      : '镜像必须有启动命令（Entrypoint 或 Cmd，两者有其一即可）。';
  if (issue.code === 'RUNTIME_NOT_PREINSTALLED')
    return `未预装 ${['claude-code', 'codex'].find((cli) => issue.path === `supportedRuntimes.${cli}` || issue.message?.includes(cli)) ?? 'Agent CLI'}，创建时需现装，启动会明显变慢`;
  return '平台返回了尚未识别的检查结果，请记录下方错误码并联系管理员。';
}

export function imageRequestFailure(error: unknown, operation: 'validate' | 'save') {
  // API 错误形状由 hook 传入，不复制 wire 信封。
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'NETWORK_ERROR';
  const copy: Record<string, string> = {
    REGISTRY_UNREACHABLE: '连不上镜像下载源。检查网络、DNS、下载源是否可用，再重试。',
    REF_NOT_FOUND: '镜像下载源上没有这个名字或这个版本。检查拼写与版本，并确认你有权读取这个镜像。',
    INVALID_IMAGE_REFERENCE: '镜像地址里混进了空白或控制字符。改好地址后再验证。',
    INVALID_STATE:
      '平台还没有可用的预制镜像作来源比对。这是平台的部署问题，不是你这张镜像的问题，不用改 Dockerfile。',
    NETWORK_ERROR: '网络不通，请检查连接后重试。',
  };
  return {
    message: copy[code] ?? '平台没能完成这次操作，请记录错误码并联系管理员。',
    code,
    retryable: code === 'REGISTRY_UNREACHABLE' || code === 'NETWORK_ERROR',
    systemLink: code === 'INVALID_STATE',
    operation,
  };
}
