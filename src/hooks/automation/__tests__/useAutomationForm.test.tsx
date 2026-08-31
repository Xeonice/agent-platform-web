// 表单草稿 hook（F21-7 §7.1 `useAutomations` ④⑤⑥ 的前端侧防线 + 15 §3.5 安全红线）。
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { draftFromDto, emptyDraft, useAutomationForm } from '@/hooks/automation/useAutomationForm';
import { useAppStore } from '@/stores';
import type { AutomationDto } from '@/types/automation';

const DTO: AutomationDto = {
  id: 'a1',
  projectId: 'p1',
  name: '每天凌晨数据分析',
  runtime: 'codex',
  prompt: '汇总昨天的日志',
  scheduleKind: 'daily',
  scheduleConfig: { time: '08:00' },
  timezone: 'Pacific/Chatham',
  timeoutMinutes: 120,
  artifactRetentionDays: 7,
  enabled: true,
  degraded: false,
  consecutiveFailures: 0,
  triggerOn: 'failure',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('draftFromDto / emptyDraft', () => {
  it('⭐ 编辑回填取**规则的时区快照**，且 timezoneTouched 为 false', () => {
    const draft = draftFromDto(DTO);
    expect(draft.timezone).toBe('Pacific/Chatham');
    // 这两句合起来就是 I-AUT-9 的前端侧防线：不动它，PUT 里就不会出现这个键。
    expect(draft.timezoneTouched).toBe(false);
  });

  it('新建草稿默认 2 小时超时 / 7 天保留期 / 每天 08:00（P21-7 §3.2 的默认值）', () => {
    const draft = emptyDraft();
    expect(draft.timeoutMinutes).toBe(120);
    expect(draft.artifactRetentionDays).toBe(7);
    expect(draft.scheduleKind).toBe('daily');
    expect(draft.triggerOn).toBe('failure');
    expect(draft.webhookEnabled).toBe(false);
  });

  it('后端给了档位外的保留期 → 回落 7 天（契约里它是裸 number，闭集在生成物里丢了）', () => {
    expect(draftFromDto({ ...DTO, artifactRetentionDays: 99 }).artifactRetentionDays).toBe(7);
    expect(draftFromDto({ ...DTO, artifactRetentionDays: 3 }).artifactRetentionDays).toBe(3);
    expect(draftFromDto({ ...DTO, artifactRetentionDays: 30 }).artifactRetentionDays).toBe(30);
  });
});

describe('⭐⭐ timezone 只有一条改法：setTimeZone', () => {
  it('patch({ timezone }) 被丢弃 —— 时区不变、touched 不变', () => {
    // ⚠️ 这条是**变异测试逼出来的**（M25：把 patch 里的两行 delete 删掉，133 条用例全绿）。
    //    那两行是 I-AUT-9 的第二道防线：草稿对象本来就带 `timezone` 字段，
    //    将来任何一个"顺手 patch 一下整个草稿"的调用点，都会在不置 `timezoneTouched`
    //    的情况下改掉时区 ⇒ PUT 又开始隐式重传，而界面上没有任何提示。
    //    防线只有被测到才算防线。
    const { result } = renderHook(() => useAutomationForm(draftFromDto(DTO)));
    act(() => {
      result.current.patch({ name: '改个名', timezone: 'UTC' });
    });
    expect(result.current.draft.name).toBe('改个名');
    expect(result.current.draft.timezone).toBe('Pacific/Chatham');
    expect(result.current.draft.timezoneTouched).toBe(false);
    expect('timezone' in result.current.updatePayload()).toBe(false);
  });

  it('patch({ timezoneTouched: true }) 也被丢弃（不能凭空把"改过"这一位点亮）', () => {
    const { result } = renderHook(() => useAutomationForm(draftFromDto(DTO)));
    act(() => {
      result.current.patch({ timezoneTouched: true });
    });
    expect(result.current.draft.timezoneTouched).toBe(false);
  });

  it('setTimeZone 才会同时改值并置 touched，PUT 这才带上它', () => {
    const { result } = renderHook(() => useAutomationForm(draftFromDto(DTO)));
    act(() => {
      result.current.setTimeZone('UTC');
    });
    expect(result.current.draft.timezone).toBe('UTC');
    expect(result.current.draft.timezoneTouched).toBe(true);
    expect(result.current.updatePayload()).toMatchObject({ timezone: 'UTC' });
  });
});

describe('校验与预览', () => {
  it('空草稿不可保存；填齐可保存', () => {
    const { result } = renderHook(() => useAutomationForm(emptyDraft()));
    expect(result.current.canSave).toBe(false);
    act(() => {
      result.current.patch({ name: 'n', runtime: 'codex', prompt: 'x' });
    });
    expect(result.current.canSave).toBe(true);
  });

  it('⭐ 调度预览永远带时区（缺了它，那串数字是无意义的）', () => {
    const { result } = renderHook(() => useAutomationForm(draftFromDto(DTO)));
    expect(result.current.schedulePreview).toBe('每天 08:00（Pacific/Chatham）');
  });

  it('prompt 计数按码点', () => {
    const { result } = renderHook(() => useAutomationForm(emptyDraft()));
    act(() => {
      result.current.patch({ prompt: '🙂🙂' });
    });
    expect(result.current.promptCount).toBe(2);
  });
});

describe('⭐⭐ 15 §3.5 安全红线：草稿里的 prompt 绝不进 store / persist', () => {
  it('输入指令之后，全局 store 与 localStorage 里都找不到它', () => {
    const SECRET = '这段指令绝不该出现在任何持久化里-CANARY-8831';
    const { result } = renderHook(() => useAutomationForm(emptyDraft()));
    act(() => {
      result.current.patch({ name: 'n', runtime: 'codex', prompt: SECRET });
    });
    expect(result.current.draft.prompt).toBe(SECRET);

    // ① 全局 store 的任何一个字段都不含它 —— `uiSlice` 上连一个能装它的位置都不该有。
    expect(JSON.stringify(useAppStore.getState())).not.toContain(SECRET);
    // ② localStorage（persist 白名单）同样不含。
    expect(JSON.stringify(globalThis.localStorage)).not.toContain(SECRET);
  });

  it('hook 卸载后草稿随之消失（下一次挂载拿到的是干净的空草稿）', () => {
    const first = renderHook(() => useAutomationForm(emptyDraft()));
    act(() => {
      first.result.current.patch({ prompt: '上一轮的指令' });
    });
    first.unmount();
    const second = renderHook(() => useAutomationForm(emptyDraft()));
    expect(second.result.current.draft.prompt).toBe('');
  });
});
