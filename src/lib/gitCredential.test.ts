import { describe, it, expect } from 'vitest';
import {
  platformToHost,
  sshKeyHasPassphrase,
  looksLikePrivateKey,
  isAllowedHostsValid,
  normalizeHost,
  gitTestErrorMessage,
  credentialTypeLabel,
} from '@/lib/gitCredential';

describe('platformToHost（选来源自动推导 host）', () => {
  it('SaaS 三家推导固定 host', () => {
    expect(platformToHost('github')).toBe('github.com');
    expect(platformToHost('gitlab')).toBe('gitlab.com');
    expect(platformToHost('gitee')).toBe('gitee.com');
  });
  it('其他（自建）→ null（交用户手填）', () => {
    expect(platformToHost('other')).toBeNull();
  });
});

describe('sshKeyHasPassphrase（passphrase 私钥 MVP 不支持，保存前预校验）', () => {
  it('经典 PEM 加密（Proc-Type/DEK-Info）→ true', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'Proc-Type: 4,ENCRYPTED',
      'DEK-Info: AES-128-CBC,ABC123',
      '...',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    expect(sshKeyHasPassphrase(key)).toBe(true);
  });
  it('PKCS#8 加密（BEGIN ENCRYPTED PRIVATE KEY）→ true', () => {
    expect(
      sshKeyHasPassphrase(
        '-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----',
      ),
    ).toBe(true);
  });
  it('无口令私钥 → false', () => {
    const key =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1r\n-----END OPENSSH PRIVATE KEY-----';
    expect(sshKeyHasPassphrase(key)).toBe(false);
  });
});

describe('looksLikePrivateKey', () => {
  it('识别 PEM 私钥头', () => {
    expect(looksLikePrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\n...')).toBe(true);
    expect(looksLikePrivateKey('ssh-rsa AAAAB3Nz... user@host')).toBe(false);
  });
});

describe('host 白名单校验', () => {
  it('规范化去空白 + 小写', () => {
    expect(normalizeHost('  GitHub.com ')).toBe('github.com');
  });
  it('≥1 且每个非空才有效', () => {
    expect(isAllowedHostsValid([])).toBe(false);
    expect(isAllowedHostsValid(['github.com'])).toBe(true);
    expect(isAllowedHostsValid(['github.com', '   '])).toBe(false);
  });
});

describe('gitTestErrorMessage（errorCode → 人话，绝不含 ref 名）', () => {
  it('认证/权限类归一', () => {
    for (const code of ['AUTH_FAILED', 'PERMISSION', 'UNAUTHORIZED', 'CLONE_FAILED_PERMISSION']) {
      expect(gitTestErrorMessage(code)).toContain('认证失败');
    }
  });
  it('本地 15s 超时兜底文案', () => {
    expect(gitTestErrorMessage('TIMEOUT_LOCAL')).toContain('15 秒');
  });
  it('host 不在白名单 → 明确提示不会携带凭证', () => {
    expect(gitTestErrorMessage('HOST_NOT_ALLOWED')).toContain('白名单');
  });
  it('未知码走通用', () => {
    expect(gitTestErrorMessage('SOMETHING_NEW')).toBe('连接失败，请检查凭证与仓库地址后重试。');
    expect(gitTestErrorMessage(undefined)).toBe('连接失败，请检查凭证与仓库地址后重试。');
  });
});

describe('credentialTypeLabel', () => {
  it('两类展示名', () => {
    expect(credentialTypeLabel('ssh-key')).toBe('SSH 私钥');
    expect(credentialTypeLabel('https-token')).toBe('HTTPS Token');
  });
});
