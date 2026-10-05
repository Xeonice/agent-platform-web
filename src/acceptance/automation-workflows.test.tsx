import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AutomationsPanelContainer } from '@/containers/project/AutomationsPanelContainer';
import { server } from '@/acceptance/support/server';
import { API, NOW } from '@/acceptance/support/fixtures';
import { mount } from '@/acceptance/support/mount';
import { AutomationDtoSchema } from '@/types/automation.schema';
import type {
  AutomationDto,
  AutomationRunDto,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '@/types/automation';

const createPayloadSchema = AutomationDtoSchema.pick({
  name: true,
  description: true,
  runtime: true,
  prompt: true,
  scheduleKind: true,
  scheduleConfig: true,
  timezone: true,
  timeoutMinutes: true,
  artifactRetentionDays: true,
  webhookUrl: true,
  triggerOn: true,
}).partial({ triggerOn: true });
const updatePayloadSchema = createPayloadSchema.partial({ timezone: true });

function rule(extra: Partial<AutomationDto> = {}): AutomationDto {
  return {
    id: 'rule-a',
    projectId: 'project-a',
    name: '每天凌晨跑一遍回归',
    runtime: 'codex',
    prompt: '运行项目回归',
    scheduleKind: 'daily',
    scheduleConfig: { time: '03:00' },
    timezone: 'Asia/Shanghai',
    timeoutMinutes: 120,
    artifactRetentionDays: 7,
    triggerOn: 'failure',
    enabled: true,
    degraded: false,
    consecutiveFailures: 0,
    nextTriggerAt: '2026-10-06T19:00:00.000Z',
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}
function reads(list: () => AutomationDto[], runs: AutomationRunDto[] = []) {
  server.use(
    http.get(`${API}/api/projects/project-a/automations`, () => HttpResponse.json(list())),
    http.get(`${API}/api/automations/rule-a/runs`, () =>
      HttpResponse.json({ items: runs, hasMore: false }),
    ),
  );
}
function panel(extra: Partial<Parameters<typeof AutomationsPanelContainer>[0]> = {}) {
  return mount(
    <AutomationsPanelContainer
      projectId="project-a"
      projectName="acme-web"
      onClose={vi.fn()}
      {...extra}
    />,
  );
}

describe('AUT · fresh real-container HTTP workflows', () => {
  it('creates a valid rule in one dialog, snapshots timezone/default retention, and edits without implicitly moving that timezone', async () => {
    let current: AutomationDto[] = [];
    let created: CreateAutomationRequest | undefined;
    let updated: UpdateAutomationRequest | undefined;
    reads(() => current);
    server.use(
      http.post(`${API}/api/projects/project-a/automations`, async ({ request }) => {
        expect(request.credentials).toBe('include');
        created = createPayloadSchema.parse(await request.json());
        current = [rule(created)];
        return HttpResponse.json(current[0], { status: 201 });
      }),
      http.put(`${API}/api/automations/rule-a`, async ({ request }) => {
        updated = updatePayloadSchema.parse(await request.json());
        current = [rule({ ...current[0], ...updated })];
        return HttpResponse.json(current[0]);
      }),
    );
    panel();
    await screen.findByTestId('automation-empty');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByTestId('automation-create'));
    expect(screen.getByTestId('form-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('form-name'), { target: { value: '晨间回归' } });
    fireEvent.change(screen.getByTestId('form-runtime'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByTestId('form-prompt'), { target: { value: '运行全部回归' } });
    fireEvent.change(screen.getByTestId('schedule-timezone'), {
      target: { value: 'Asia/Shanghai' },
    });
    fireEvent.click(screen.getByTestId('form-save'));
    await screen.findByTestId('automation-detail');
    expect(created).toMatchObject({
      name: '晨间回归',
      prompt: '运行全部回归',
      timezone: 'Asia/Shanghai',
      artifactRetentionDays: 7,
      timeoutMinutes: 120,
    });
    expect(screen.getAllByRole('dialog')).toEqual([dialog]);
    fireEvent.click(screen.getByTestId('detail-edit'));
    fireEvent.change(screen.getByTestId('form-prompt'), { target: { value: '补充类型检查' } });
    fireEvent.click(screen.getByTestId('form-save'));
    await screen.findByTestId('automation-detail');
    expect(updated).toMatchObject({ prompt: '补充类型检查' });
    expect(updated).not.toHaveProperty('timezone');
    expect(screen.getAllByRole('dialog')).toEqual([dialog]);
    const persisted = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.getItem(localStorage.key(index) ?? ''),
    ).join('');
    expect(persisted).not.toContain('运行全部回归');
    expect(persisted).not.toContain('补充类型检查');
  });

  it('reenables an automatically stopped rule through the real endpoint, adopting the reset server state and original schedule', async () => {
    let current = rule({ enabled: false, degraded: true, consecutiveFailures: 10 });
    let enables = 0;
    reads(() => [current]);
    server.use(
      http.post(`${API}/api/automations/rule-a/enable`, () => {
        enables += 1;
        current = rule({ timezone: current.timezone, scheduleConfig: current.scheduleConfig });
        return HttpResponse.json(current);
      }),
    );
    panel({ focusRuleId: 'rule-a' });
    await screen.findByTestId('automation-detail');
    expect(screen.getByTestId('detail-status')).toHaveTextContent('已自动停用');
    fireEvent.click(screen.getByTestId('detail-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('detail-status')).toHaveTextContent('已开启');
    });
    expect(enables).toBe(1);
    expect(current).toMatchObject({
      consecutiveFailures: 0,
      degraded: false,
      enabled: true,
      timezone: 'Asia/Shanghai',
      scheduleConfig: { time: '03:00' },
    });
  });

  it('uses authoritative deletion counts, cancels to detail, and protects the same confirmation dialog while DELETE is in flight', async () => {
    let current = [rule()];
    let completeDelete: (() => void) | undefined;
    const deleted = vi.fn();
    const close = vi.fn();
    reads(() => current);
    server.use(
      http.get(`${API}/api/automations/rule-a/deletion-preview`, () =>
        HttpResponse.json({
          runCount: 42,
          artifactCount: 2,
          runningTasks: [{ id: 'task-live', name: '实际仍在运行' }],
        }),
      ),
      http.delete(`${API}/api/automations/rule-a`, async () => {
        deleted();
        await new Promise<void>((resolve) => {
          completeDelete = resolve;
        });
        current = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    panel({ focusRuleId: 'rule-a', onClose: close });
    await screen.findByTestId('automation-detail');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByTestId('detail-delete'));
    await screen.findByText(/42 次运行历史/);
    expect(screen.getByText(/2 份运行成果/)).toBeInTheDocument();
    expect(screen.getByText(/正在跑的任务「实际仍在运行」不会被中断/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('detail-delete-confirm-no')).toHaveFocus();
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await screen.findByTestId('automation-detail');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('detail-delete'));
    fireEvent.click(await screen.findByTestId('detail-delete-confirm-yes'));
    await waitFor(() => {
      expect(deleted).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('detail-delete-confirm-yes')).toBeDisabled();
    expect(screen.getByTestId('detail-delete-confirm-no')).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByTestId('detail-delete-confirm')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toEqual([dialog]);
    completeDelete?.();
    await screen.findByTestId('automation-empty');
    expect(close).not.toHaveBeenCalled();
  });

  it('locates the latest failure beyond the preview and routes a finished run to its actual artifact, retaining output and failed webhook evidence', async () => {
    const runs: AutomationRunDto[] = Array.from({ length: 13 }, (_, index) => ({
      id: `run-${String(index)}`,
      automationId: 'rule-a',
      status: index === 11 ? 'failed' : 'success',
      retryCount: 0,
      triggeredAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
      durationMs: 1234,
      sandboxId: index === 11 ? 'task-failed' : `task-${String(index)}`,
      ...(index === 11
        ? {
            outputSummary: '实际已保留的输出',
            errorMessage: 'actual exit 1',
            webhookStatus: 'failed' as const,
          }
        : {}),
    }));
    reads(() => [rule({ degraded: true, consecutiveFailures: 3 })], runs);
    const artifacts = vi.fn();
    const tasks = vi.fn();
    panel({ onViewArtifacts: artifacts, onOpenTask: tasks });
    fireEvent.click(await screen.findByTestId('automation-show-failure'));
    await screen.findByText('实际已保留的输出');
    const failed = screen
      .getAllByTestId('run-history-item')
      .find((row) => row.getAttribute('data-run-id') === 'run-11');
    expect(failed).toBeDefined();
    const failure = within(failed!);
    await waitFor(() => {
      expect(failure.getByRole('button', { name: '收起' })).toHaveFocus();
    });
    expect(failure.getByTestId('run-webhook-note')).toHaveTextContent('规则本身的状态不受影响');
    expect(failure.queryByRole('button', { name: '打开任务' })).not.toBeInTheDocument();
    fireEvent.click(failure.getByRole('button', { name: '查看成果' }));
    expect(artifacts).toHaveBeenCalledWith('task-failed');
    expect(tasks).not.toHaveBeenCalled();
  });
});
