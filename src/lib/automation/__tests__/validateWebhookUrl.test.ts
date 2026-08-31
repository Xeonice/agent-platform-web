// Webhook URL 校验（F21-7 §7.1）。
import { describe, it, expect } from 'vitest';
import { WEBHOOK_DELIVERY_NOTE, validateWebhookUrl } from '@/lib/automation/validateWebhookUrl';

describe('validateWebhookUrl', () => {
  it('http / https 通过', () => {
    expect(validateWebhookUrl('http://example.com/hook', true).ok).toBe(true);
    expect(validateWebhookUrl('https://example.com/hook', true).ok).toBe(true);
  });

  it('非法协议拒绝', () => {
    for (const url of ['ftp://x/y', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(validateWebhookUrl(url, true).ok).toBe(false);
    }
  });

  it('完全不是 URL → 拒绝', () => {
    expect(validateWebhookUrl('example.com', true).ok).toBe(false);
  });

  it('⭐ 启用了通知但 URL 为空 → 拒绝保存', () => {
    // 存下一条"开着但发不出去"的规则，等于静默失效——而 webhook 的全部价值在"我不在的时候"。
    expect(validateWebhookUrl('', true).ok).toBe(false);
    expect(validateWebhookUrl('   ', true).ok).toBe(false);
  });

  it('未启用时空 URL 合法（没启用就没这回事）', () => {
    expect(validateWebhookUrl('', false).ok).toBe(true);
    // 未启用时连非法值都不拦——那个输入框根本不会被提交。
    expect(validateWebhookUrl('not a url', false).ok).toBe(true);
  });

  it('⭐ 私网地址**不**在前端拦（03 §8.5：SSRF 判定在后端）', () => {
    // 前端拦私网只会挡掉私有化部署的主要用法，真正的绕过（解析到内网的公网域名）照样过。
    expect(validateWebhookUrl('http://10.0.0.5/hook', true).ok).toBe(true);
    expect(validateWebhookUrl('http://192.168.1.10:8080/hook', true).ok).toBe(true);
  });
});

describe('WEBHOOK_DELIVERY_NOTE', () => {
  it('⭐ 退避序列是 5s / 25s，不是 1s→2s→4s（F21-7 §9.1 #12 点名）', () => {
    expect(WEBHOOK_DELIVERY_NOTE).toContain('10 秒');
    expect(WEBHOOK_DELIVERY_NOTE).toContain('2 次');
    expect(WEBHOOK_DELIVERY_NOTE).toContain('5 秒');
    expect(WEBHOOK_DELIVERY_NOTE).toContain('25 秒');
    expect(WEBHOOK_DELIVERY_NOTE).not.toContain('4 秒');
  });

  it('⭐ 明说投递失败不影响规则状态（P21-7 §9.1 #30 否定性验收）', () => {
    expect(WEBHOOK_DELIVERY_NOTE).toContain('不影响规则');
  });
});
