import { describe, it, expect } from 'vitest';
import {
  classifyStatus,
  phaseIndexForStatus,
  phaseKeyForStatus,
  startupPercent,
  buildEventsSocketUri,
  STARTUP_PHASES,
  INSTANCE_PHASE_KEY,
} from '@/lib/sandboxLifecycle';

describe('sandboxLifecycle 映射（10 §7.4 / P20 §3.3）', () => {
  it('startup 状态集 → startup 决策；status → 展示格按「展示序」映射', () => {
    expect(classifyStatus('pending')).toBe('startup');
    expect(classifyStatus('scheduling')).toBe('startup');
    expect(classifyStatus('preparing-workspace')).toBe('startup');
    expect(classifyStatus('creating')).toBe('startup');
    expect(classifyStatus('starting')).toBe('startup');

    // 12 值里的 5 个启动态全部有归宿（多对一）。
    expect(phaseKeyForStatus('pending')).toBe('init');
    expect(phaseKeyForStatus('scheduling')).toBe('init');
    expect(phaseKeyForStatus('creating')).toBe('image');
    expect(phaseKeyForStatus('preparing-workspace')).toBe('workspace');
    expect(phaseKeyForStatus('starting')).toBe('instance');

    expect(phaseIndexForStatus('pending')).toBe(0);
    expect(phaseIndexForStatus('scheduling')).toBe(0);
    // ⚠️ 关键回归：`creating`（技术上更晚）落在展示第 2 格「拉取镜像」，
    // `preparing-workspace`（技术上更早）落在展示第 3 格「准备工作区」——展示序 ≠ 状态机序，这是预期。
    expect(phaseIndexForStatus('creating')).toBe(1);
    expect(phaseIndexForStatus('preparing-workspace')).toBe(2);
    expect(phaseIndexForStatus('starting')).toBe(3);
    // 未知状态兜底到首格，不抛错、不塌陷。
    expect(phaseIndexForStatus('weird')).toBe(0);
    expect(phaseKeyForStatus('weird')).toBe('init');
  });

  it('running / idle → running（可开终端）；failed → failed；停止态 → ended', () => {
    expect(classifyStatus('running')).toBe('running');
    expect(classifyStatus('idle')).toBe('running');
    expect(classifyStatus('failed')).toBe('failed');
    for (const s of ['stopping', 'stopped', 'destroying', 'destroyed']) {
      expect(classifyStatus(s)).toBe('ended');
    }
    expect(classifyStatus('weird')).toBe('unknown');
  });

  it('startupPercent 按**技术推进序**单调递增且 running 前 < 100（不随展示格顺序倒退）', () => {
    // 技术顺序：pending → preparing-workspace → creating → starting
    const seq = ['pending', 'preparing-workspace', 'creating', 'starting'].map(startupPercent);
    expect(seq).toEqual([20, 40, 60, 80]);
    for (const p of seq) expect(p).toBeLessThan(100);
    // 严格递增
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThan(seq[i - 1]!);
  });

  it('四阶段标签顺序 = 面向用户的展示序（P20 §3.3），刻意 ≠ 状态机序', () => {
    expect(STARTUP_PHASES.map((p) => p.label)).toEqual([
      '初始化',
      '拉取镜像',
      '准备工作区',
      '启动实例',
    ]);
    // 格数恒为 4（结构性回归：不因状态多了就多一格）。
    expect(STARTUP_PHASES).toHaveLength(4);
    // 装 CLI 子文案挂「启动实例」格（03 §4.3：装 CLI / 注凭证 / 起 agent 会话都在 starting 段内）。
    expect(INSTANCE_PHASE_KEY).toBe('instance');
    expect(STARTUP_PHASES.at(-1)?.key).toBe(INSTANCE_PHASE_KEY);
  });

  it('buildEventsSocketUri 归一化 origin 并挂 /events', () => {
    expect(buildEventsSocketUri('ws://localhost:3001')).toBe('http://localhost:3001/events');
    expect(buildEventsSocketUri('wss://api.example.com/')).toBe('https://api.example.com/events');
    expect(buildEventsSocketUri('http://localhost:3001')).toBe('http://localhost:3001/events');
  });
});
