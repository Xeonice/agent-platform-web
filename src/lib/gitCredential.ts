// Git 凭证的纯派生（可单测）：平台→host 推导、passphrase 预校验、测试连接错误码人话映射、host 校验。
// UI 决策集中于此，view 只吃结果（07 §6）。零副作用、零网络。
import type { GitPlatform } from '@/types/gitCredential';
import { GIT_PLATFORMS, isKnownGitPlatform } from '@/lib/gitPlatforms';

/**
 * 选来源 → 自动推导 host；'other'（自建）返回 null 交由用户手填（F21-3 §10.2）。
 * host 取自 `GIT_PLATFORMS` 注册表（单一来源），加平台只改那一处。
 */
export function platformToHost(platform: GitPlatform): string | null {
  return isKnownGitPlatform(platform) ? GIT_PLATFORMS[platform].defaultHost : null;
}

/** 选型引导文案（P21-3 §10.2）：SaaS→Token，自建→SSH。 */
export const GIT_CREDENTIAL_GUIDANCE =
  'GitHub / GitLab SaaS → HTTPS Token；公司自建 Git（SSH 接入）→ SSH 密钥。';

/** HTTPS Token scope 提示（P21-3 §10.2）。 */
export const HTTPS_TOKEN_SCOPE_HINT = '需 repo（仓库读取）权限的 Token。';

/**
 * 私钥是否带 passphrase（MVP 不支持，保存前本地预校验并提示，P21-3 §10.2）。
 * 经典 PEM 加密：`Proc-Type: 4,ENCRYPTED` / `DEK-Info:`；PKCS#8 加密：`BEGIN ENCRYPTED PRIVATE KEY`。
 * OpenSSH 新格式的加密无法从明文可靠判定，交由后端返回错误码兜底（gitTestErrorMessage）。
 */
export function sshKeyHasPassphrase(privateKey: string): boolean {
  const text = privateKey.toUpperCase();
  return (
    text.includes('PROC-TYPE: 4,ENCRYPTED') ||
    text.includes('PROC-TYPE:4,ENCRYPTED') ||
    text.includes('DEK-INFO:') ||
    text.includes('BEGIN ENCRYPTED PRIVATE KEY')
  );
}

/** 粗校验是否看起来是一段 PEM 私钥（避免把 public key / 随手粘贴当私钥保存）。 */
export function looksLikePrivateKey(privateKey: string): boolean {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(privateKey);
}

/** host 规范化 + 非空校验（去空白，允许 host 或 host:port，不接受含协议/路径的整串 URL）。 */
export function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase();
}

/** host 白名单是否有效（HTTPS Token 需 ≥1 且每个非空）。 */
export function isAllowedHostsValid(hosts: string[]): boolean {
  return hosts.length > 0 && hosts.every((h) => normalizeHost(h) !== '');
}

/**
 * 测试连接错误码 → 人话。**绝不展示任何 ref 名**。仅两个真实来源，其余一律走 default 通用文案：
 *  - `CLONE_FAILED_PERMISSION | CLONE_FAILED_NETWORK | TIMEOUT`：POST /api/credentials/git/test 的 200
 *    响应体 `GitTestResultResponseDto.errorCode`（生成物枚举背书，见 GitTestErrorCodeSchema）。后端把
 *    host 不在白名单 / 解密失败均归一为 `CLONE_FAILED_PERMISSION`（credential-application.service
 *    #testGitCredential），故这里不单列 host/解密码。
 *  - `TIMEOUT_LOCAL`：前端 15s 兜底超时（非后端返回，P21-3 §10.3）。
 *
 * 其余异常无契约背书、生成物未声明：inline 私钥带 passphrase / 空白名单 → 后端 400，stored 不存在或已
 * 吊销 → 404，均为 Nest 默认异常体，前端 toApiError 归一为 code:'UNKNOWN' → 落 default。旧实现里的
 * AUTH_FAILED / UNAUTHORIZED / HOST_NOT_ALLOWED / SSH_KEY_PASSPHRASE_UNSUPPORTED / HOST_KEY_MISMATCH /
 * REPO_NOT_FOUND / 裸 PERMISSION / 裸 NETWORK 在后端源码中均无产出点，已删除（避免臆造错误码）。
 */
export function gitTestErrorMessage(errorCode: string | undefined): string {
  switch (errorCode) {
    case 'CLONE_FAILED_PERMISSION':
      return '认证失败：凭证无效、没有该仓库访问权限，或目标 host 不在白名单内，请检查凭证与 host 白名单。';
    case 'CLONE_FAILED_NETWORK':
      return '网络错误，请检查网络后重试。';
    case 'TIMEOUT':
    case 'TIMEOUT_LOCAL':
      return '测试连接超时（15 秒），仓库较大或网络较慢，请稍后重试。';
    default:
      return '连接失败，请检查凭证与仓库地址后重试。';
  }
}

/** 凭证类型展示名。 */
export function credentialTypeLabel(type: 'ssh-key' | 'https-token'): string {
  return type === 'ssh-key' ? 'SSH 私钥' : 'HTTPS Token';
}
