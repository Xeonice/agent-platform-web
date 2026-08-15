import { describe, it, expect } from 'vitest';
import {
  classifyStatus,
  phaseIndexForStatus,
  startupPercent,
  buildEventsSocketUri,
  STARTUP_PHASES,
} from '@/lib/sandboxLifecycle';

describe('sandboxLifecycle 映射（10 §7.4 / P20 §3.3）', () => {
  it('startup 状态集 → startup 决策，phase 单调映射四阶段', () => {
    expect(classifyStatus('pending')).toBe('startup');
    expect(classifyStatus('scheduling')).toBe('startup');
    expect(classifyStatus('preparing-workspace')).toBe('startup');
    expect(classifyStatus('creating')).toBe('startup');
    expect(classifyStatus('starting')).toBe('startup');

    expect(phaseIndexForStatus('pending')).toBe(0);
    expect(phaseIndexForStatus('scheduling')).toBe(0);
    expect(phaseIndexForStatus('preparing-workspace')).toBe(1);
    expect(phaseIndexForStatus('creating')).toBe(2);
    expect(phaseIndexForStatus('starting')).toBe(3);
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

  it('startupPercent 单调递增且 running 前 < 100（避免卡死观感）', () => {
    const seq = ['pending', 'preparing-workspace', 'creating', 'starting'].map(startupPercent);
    expect(seq).toEqual([20, 40, 60, 80]);
    for (const p of seq) expect(p).toBeLessThan(100);
    // 严格递增
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThan(seq[i - 1]!);
  });

  it('四阶段标签顺序稳定', () => {
    expect(STARTUP_PHASES.map((p) => p.label)).toEqual([
      '初始化',
      '准备工作区',
      '拉取镜像',
      '启动实例',
    ]);
  });

  it('buildEventsSocketUri 归一化 origin 并挂 /events', () => {
    expect(buildEventsSocketUri('ws://localhost:3001')).toBe('http://localhost:3001/events');
    expect(buildEventsSocketUri('wss://api.example.com/')).toBe('https://api.example.com/events');
    expect(buildEventsSocketUri('http://localhost:3001')).toBe('http://localhost:3001/events');
  });
});
