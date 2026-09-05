import { describe, expect, it } from 'vitest';
import { presetImageChainModel } from '../presetImageChain';
import type { DiagnoseCheckFrame } from '@/types/sse-protocol';

function frame(detail: Record<string, unknown> | undefined): DiagnoseCheckFrame {
  // ⚠️ 直接构造成契约类型，不用 `as` —— 断言一旦打下去，**契约改了这份替身也不会红**。
  const f: DiagnoseCheckFrame = {
    event: 'check',
    id: 'preset-image',
    label: '预制镜像就绪',
    status: 'fail',
    step: 'registry',
    errorCode: 'PRESET_IMAGE_NOT_IN_REGISTRY',
    summary: "镜像 'localhost:5001/platform/sandbox:v2' 在 registry 里解析不到",
    hint: 'docker build -t x . && docker push x',
    detail,
    durationMs: 3,
  };
  return f;
}

const build = (detail: Record<string, unknown> | undefined) =>
  presetImageChainModel({ phase: 'done', frame: frame(detail) }).steps.find(
    (s) => s.step === 'registry',
  )!;

const OFFER = {
  provisionable: true,
  source: 'local-docker',
  from: '本机 docker 镜像库',
  to: 'localhost:5001',
  sizeBytes: null,
  why: '字节已经在本机 docker 镜像库里，只是没推到 registry',
};

describe('第 2 步：能自己搬时不再给命令（P21-8 §2 ⇒ 新判据）', () => {
  it('⛔ 可搬运 ⇒ 有 provision、**没有 fixCommand**（两个都给等于让用户在按钮和命令之间选）', () => {
    const s = build({ provision: OFFER });
    expect(s.provision).toBeDefined();
    expect(s.fixCommand).toBeUndefined();
  });

  it('不可搬运 ⇒ 保留原来的命令（那一格的原决定是对的）', () => {
    const s = build({ provision: { ...OFFER, provisionable: false } });
    expect(s.provision).toBeUndefined();
    expect(s.fixCommand).toContain('docker build');
  });

  it('⛔ 老后端（detail 里没有 provision）⇒ 当成「不能搬」，**不许猜**', () => {
    const s = build({ ref: 'x' });
    expect(s.provision).toBeUndefined();
    expect(s.fixCommand).toBeDefined();
  });

  it('⛔ detail 整个缺席也不许崩', () => {
    expect(() => build(undefined)).not.toThrow();
    expect(build(undefined).provision).toBeUndefined();
  });

  it('sizeBytes 给得出就带上；⛔ null 原样传下去，不许读成 0', () => {
    expect(build({ provision: { ...OFFER, sizeBytes: 430_725_526 } }).provision?.sizeBytes).toBe(
      430_725_526,
    );
    expect(build({ provision: OFFER }).provision?.sizeBytes).toBeNull();
  });

  it('from / to 缺失时给得出占位，不出现 undefined', () => {
    const s = build({ provision: { provisionable: true } });
    expect(s.provision?.from).toContain('未知');
    expect(s.provision?.to).toContain('未知');
  });
});
