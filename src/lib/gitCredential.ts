// Git 凭证的纯派生（可单测）：平台→host 推导、passphrase 预校验、测试连接错误码人话映射、host 校验。
// UI 决策集中于此，view 只吃结果（07 §6）。零副作用、零网络。
import type { GitPlatform } from '@/types/gitCredential';

/** 选来源 → 自动推导 host；'other'（自建）返回 null 交由用户手填（F21-3 §10.2）。 */
export function platformToHost(platform: GitPlatform): string | null {
  switch (platform) {
    case 'github':
      return 'github.com';
    case 'gitlab':
      return 'gitlab.com';
    case 'gitee':
      return 'gitee.com';
    case 'other':
      return null;
  }
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
 * 测试连接 / 保存的错误码 → 人话（P22 §1 映射；未知码走通用）。**绝不展示任何 ref 名**。
 * `TIMEOUT_LOCAL` 为前端 15s 兜底超时（非后端返回，P21-3 §10.3）。
 */
export function gitTestErrorMessage(errorCode: string | undefined): string {
  switch (errorCode) {
    case 'AUTH_FAILED':
    case 'PERMISSION':
    case 'UNAUTHORIZED':
    case 'CLONE_FAILED_PERMISSION':
      return '认证失败：凭证无效或没有该仓库的访问权限，请检查凭证。';
    case 'HOST_NOT_ALLOWED':
      return '目标主机不在 host 白名单内，凭证不会被使用；请把该主机加入白名单。';
    case 'SSH_KEY_PASSPHRASE_UNSUPPORTED':
      return '带 passphrase 的私钥当前不支持，请改用无口令的密钥。';
    case 'HOST_KEY_MISMATCH':
      return '主机指纹与已记录的不一致，可能存在中间人风险，已中止连接。';
    case 'NETWORK':
    case 'CLONE_FAILED_NETWORK':
      return '网络错误，请检查网络后重试。';
    case 'TIMEOUT':
    case 'TIMEOUT_LOCAL':
      return '测试连接超时（15 秒），仓库较大或网络较慢，请稍后重试。';
    case 'REPO_NOT_FOUND':
      return '找不到目标仓库，请检查仓库地址。';
    default:
      return '连接失败，请检查凭证与仓库地址后重试。';
  }
}

/** 凭证类型展示名。 */
export function credentialTypeLabel(type: 'ssh-key' | 'https-token'): string {
  return type === 'ssh-key' ? 'SSH 私钥' : 'HTTPS Token';
}
