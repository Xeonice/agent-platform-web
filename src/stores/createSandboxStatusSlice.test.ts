import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/stores';

beforeEach(() => {
  useAppStore.getState().clearSandboxStatus('sb1');
  useAppStore.getState().clearSandboxStatus('sb2');
});

describe('createSandboxStatusSlice（/events 投影 10 §7.4）', () => {
  it('setSandboxStatus 种子首值', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'pending');
    expect(useAppStore.getState().sandboxStatuses['sb1']).toEqual({
      status: 'pending',
      phase: undefined,
    });
  });

  it('applySandboxEvent(status_changed) 更新 status/phase', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'creating',
      phase: 'image-pull',
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']).toMatchObject({
      status: 'creating',
      phase: 'image-pull',
    });
  });

  it('sandbox.created 落 pending 占位，不覆盖已有', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'running');
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.created',
      sandboxId: 'sb1',
      projectId: 'p1',
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.status).toBe('running');

    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.created',
      sandboxId: 'sb2',
      projectId: 'p1',
    });
    expect(useAppStore.getState().sandboxStatuses['sb2']?.status).toBe('pending');
  });

  it('sandbox.removed 删除条目', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'running');
    useAppStore.getState().applySandboxEvent({ event: 'sandbox.removed', sandboxId: 'sb1' });
    expect(useAppStore.getState().sandboxStatuses['sb1']).toBeUndefined();
  });

  it('无关事件（waiting_input）不改动状态表', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'running');
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.waiting_input',
      sandboxId: 'sb1',
      waiting: true,
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.status).toBe('running');
  });
});

describe('runtime.install_progress 投影（15 §2.3 / S5 T-3）', () => {
  it('只落 runtimeInstalls，**绝不动 sandboxStatuses**（装 CLI 期间 status 恒为 starting）', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'starting');
    useAppStore.getState().applySandboxEvent({
      event: 'runtime.install_progress',
      sandboxId: 'sb1',
      runtime: 'claude-code',
      status: 'installing',
    });

    // 状态机不被这条事件改写（否则会伪造出一次不存在的状态转移）。
    expect(useAppStore.getState().sandboxStatuses['sb1']).toEqual({
      status: 'starting',
      phase: undefined,
    });
    expect(useAppStore.getState().runtimeInstalls['sb1']).toEqual({
      runtime: 'claude-code',
      status: 'installing',
      versionDetected: undefined,
    });
  });

  it('install_progress 的 failed **不是失败兜底通道**（10 §3.1）：既不改状态、其 errorCode 也不入库', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'starting');
    useAppStore.getState().applySandboxEvent({
      event: 'runtime.install_progress',
      sandboxId: 'sb1',
      runtime: 'claude-code',
      status: 'failed',
      errorCode: 'INSTALL_FAILED',
    });
    // ① 状态机不被它改写
    expect(useAppStore.getState().sandboxStatuses['sb1']?.status).toBe('starting');
    // ② 它带的码不进失败原因字段（唯一来源是 status_changed / DTO）
    expect(useAppStore.getState().sandboxStatuses['sb1']?.failureCode).toBeUndefined();
    expect(JSON.stringify(useAppStore.getState().runtimeInstalls['sb1'])).not.toContain(
      'INSTALL_FAILED',
    );

    // 随后的权威事件到达：状态转 failed，码来自 status_changed.errorCode。
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'failed',
      errorCode: 'INSTALL_FAILED',
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.status).toBe('failed');
    expect(useAppStore.getState().sandboxStatuses['sb1']?.failureCode).toBe('INSTALL_FAILED');
  });

  it('转入 running 等终态 → 清除 install 子文案（不残留陈旧文案）', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'runtime.install_progress',
      sandboxId: 'sb1',
      runtime: 'codex',
      status: 'installed',
      versionDetected: '1.2.3',
    });
    expect(useAppStore.getState().runtimeInstalls['sb1']).toBeDefined();

    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'running',
    });
    expect(useAppStore.getState().runtimeInstalls['sb1']).toBeUndefined();
  });

  it('removed / clearSandboxStatus 同时清两张表', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'runtime.install_progress',
      sandboxId: 'sb1',
      runtime: 'codex',
      status: 'installing',
    });
    useAppStore.getState().applySandboxEvent({ event: 'sandbox.removed', sandboxId: 'sb1' });
    expect(useAppStore.getState().runtimeInstalls['sb1']).toBeUndefined();

    useAppStore.getState().applySandboxEvent({
      event: 'runtime.install_progress',
      sandboxId: 'sb2',
      runtime: 'codex',
      status: 'installing',
    });
    useAppStore.getState().clearSandboxStatus('sb2');
    expect(useAppStore.getState().runtimeInstalls['sb2']).toBeUndefined();
  });
});

describe('失败原因的两条通道写同一字段（S5 收口）', () => {
  it('通道①（即时）：WS status_changed.errorCode → failureCode；非 failed 帧不留残值', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'failed',
      errorCode: 'IMAGE_CONTRACT_VIOLATION',
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.failureCode).toBe(
      'IMAGE_CONTRACT_VIOLATION',
    );

    // 后端只在 failed 时带码；重试后转 starting 的帧不带码 ⇒ 旧码必须被清掉，不残留。
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'starting',
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.failureCode).toBeUndefined();
  });

  it('通道②（刷新恢复）：REST DTO 的 failureCode/failureMessage 经 setSandboxStatus 落同一字段', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'failed', {
      failureCode: 'IMAGE_CONTRACT_VIOLATION',
      failureMessage: 'command -v tmux exited 1',
    });
    const entry = useAppStore.getState().sandboxStatuses['sb1'];
    expect(entry?.failureCode).toBe('IMAGE_CONTRACT_VIOLATION');
    // 自由文本原样存，不参与判定（码与文本已由后端拆成两列，禁止 parse message 取码）。
    expect(entry?.failureMessage).toBe('command -v tmux exited 1');
  });
});

/**
 * `sandbox.instance_progress` 投影 + 启动计时的**锚点**（10 §7.4）。
 *
 * 背景：一次真实的 Task 停在「启动实例」3 分 10 秒、全程零反馈，用户判它卡死。审计流
 * 事后说清楚了：190529ms 全在 provider 起实例那一步（13GB 镜像本机首次使用）。
 */
describe('sandbox.instance_progress 投影 + observedAt 计时锚点（10 §7.4）', () => {
  it('只落 instanceStartups，**绝不动 sandboxStatuses**（起实例期间 status 恒为 starting）', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'starting');
    const before = useAppStore.getState().sandboxStatuses['sb1'];
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.instance_progress',
      sandboxId: 'sb1',
      phase: 'starting',
      imageStaged: false,
    });
    expect(useAppStore.getState().instanceStartups['sb1']).toEqual({
      phase: 'starting',
      imageStaged: false,
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']).toBe(before);
  });

  it('imageStaged 缺席时投影里也缺席 —— 「说不出」不许被记成 false', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.instance_progress',
      sandboxId: 'sb1',
      phase: 'starting',
    });
    expect(useAppStore.getState().instanceStartups['sb1']?.imageStaged).toBeUndefined();
  });

  it('ready 覆盖 starting（同一格里的前后两段，不是两条并存的文案）', () => {
    const apply = useAppStore.getState().applySandboxEvent;
    apply({ event: 'sandbox.instance_progress', sandboxId: 'sb1', phase: 'starting' });
    apply({ event: 'sandbox.instance_progress', sandboxId: 'sb1', phase: 'ready' });
    expect(useAppStore.getState().instanceStartups['sb1']?.phase).toBe('ready');
  });

  it('转入终态 / removed / clear 都会清掉起实例的陈旧文案', () => {
    const apply = useAppStore.getState().applySandboxEvent;
    apply({ event: 'sandbox.instance_progress', sandboxId: 'sb1', phase: 'starting' });
    apply({ event: 'sandbox.status_changed', sandboxId: 'sb1', status: 'running' });
    expect(useAppStore.getState().instanceStartups['sb1']).toBeUndefined();

    apply({ event: 'sandbox.instance_progress', sandboxId: 'sb2', phase: 'starting' });
    apply({ event: 'sandbox.removed', sandboxId: 'sb2' });
    expect(useAppStore.getState().instanceStartups['sb2']).toBeUndefined();
  });

  it('WS 的 status_changed **产生**计时锚点', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'starting',
    });
    expect(typeof useAppStore.getState().sandboxStatuses['sb1']?.observedAt).toBe('number');
  });

  it('REST 写入**不产生**锚点 —— DTO 上没有"何时进入这个状态"这回事', () => {
    // 这一条是这个字段最容易被"顺手改好"的地方：在 setSandboxStatus 里也盖一个
    // Date.now() 看起来完全合理，代价是一个 3 分钟前就开始的等待被显示成「已等待 0:02」。
    useAppStore.getState().setSandboxStatus('sb1', 'starting');
    expect(useAppStore.getState().sandboxStatuses['sb1']?.observedAt).toBeUndefined();
  });

  it('同一个 status 重放不重置锚点（WS 重连会重放最后一条状态事件）', () => {
    const apply = useAppStore.getState().applySandboxEvent;
    apply({ event: 'sandbox.status_changed', sandboxId: 'sb1', status: 'starting' });
    const first = useAppStore.getState().sandboxStatuses['sb1']?.observedAt;
    apply({ event: 'sandbox.status_changed', sandboxId: 'sb1', status: 'starting' });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.observedAt).toBe(first);
  });

  it('状态**变了**才换锚点 —— 每一格各自计时', () => {
    // ⚠️ 必须假时钟：两次 `Date.now()` 落在同一毫秒里时，「重取了」和「沿用了」长得
    // 一模一样，这条断言就会在**实现是错的**时候照样绿。
    vi.useFakeTimers();
    try {
      const apply = useAppStore.getState().applySandboxEvent;
      vi.setSystemTime(1_000);
      apply({ event: 'sandbox.status_changed', sandboxId: 'sb1', status: 'creating' });
      expect(useAppStore.getState().sandboxStatuses['sb1']?.observedAt).toBe(1_000);
      vi.setSystemTime(61_000);
      apply({ event: 'sandbox.status_changed', sandboxId: 'sb1', status: 'starting' });
      expect(useAppStore.getState().sandboxStatuses['sb1']?.observedAt).toBe(61_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('REST 刷新恢复到**同一个** status 时保住已有锚点，计时不会中途消失', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'starting',
    });
    const anchor = useAppStore.getState().sandboxStatuses['sb1']?.observedAt;
    useAppStore.getState().setSandboxStatus('sb1', 'starting');
    expect(useAppStore.getState().sandboxStatuses['sb1']?.observedAt).toBe(anchor);
  });
});
