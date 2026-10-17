import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { mount } from './support/mount';
import { API, deferred } from './support/fixtures';
import { InstanceUpgradeProviderContainer } from '@/containers/system/InstanceUpgradeProviderContainer';
import { VersionUpdateContainer } from '@/containers/system/VersionUpdateContainer';
import { VersionUpdateCardContainer } from '@/containers/system/VersionUpdateCardContainer';
import { UpgradeRequestSchema } from '@/types/upgrade-contract';
import { attemptFixture, upgradeFixture } from '@/mocks/upgrade';
import { useUpgradeReminder } from '@/hooks/system/useUpgradeReminder';
import { useUpgradeLeaveGuard } from '@/hooks/system/useUpgradeLeaveGuard';
import { upgradePendingKey } from '@/lib/system/upgradeRequestIdentity';
import { encodeDismissal, upgradeReminderKey } from '@/lib/system/upgradeReminderPreference';
import { useAppStore } from '@/stores';
import type { UpgradeRequest, UpgradeOperation } from '@/types/upgrade';
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation.push }) }));
vi.mock('@/services/system/loadedWebBuild', () => ({
  loadedWebBuild: { webRevision: 'a'.repeat(40), releaseId: '0.2.4', builtAt: null },
}));
function ui() {
  return mount(
    <InstanceUpgradeProviderContainer>
      <header>
        <input aria-label="正在输入" />
      </header>
      <VersionUpdateContainer />
      <VersionUpdateCardContainer />
    </InstanceUpgradeProviderContainer>,
  );
}
function freshStatus() {
  const status = upgradeFixture();
  status.observedAt = new Date().toISOString();
  return status;
}
describe('UPG F01/F02/F04 · real Web interaction with canonical wire', () => {
  it('async-capable requests survive a lost response and remount with the original preference and identity', async () => {
    const status = freshStatus();
    if (status.catalog.availableRelease === null) throw new Error('missing catalog fixture');
    status.catalog.availableRelease.supportsAsync = true;
    const lookupGate = deferred();
    const posts: UpgradeRequest[] = [];
    const lookups: string[] = [];
    let accepted: UpgradeOperation | null = null;
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json({ ...status, operation: accepted, observedAt: new Date().toISOString() }),
      ),
      http.post(`${API}/api/system/upgrade/requests`, async ({ request }) => {
        expect(request.headers.get('Prefer')).toBe('respond-async');
        const body = UpgradeRequestSchema.parse(await request.json());
        posts.push(body);
        return HttpResponse.error();
      }),
      http.get(`${API}/api/system/upgrade/requests/:requestId`, async ({ params, request }) => {
        expect(request.headers.get('Prefer')).toBe('respond-async');
        lookups.push(String(params['requestId']));
        await lookupGate.promise;
        const input = posts[0];
        if (input === undefined) throw new Error('command not received');
        accepted = {
          instanceId: status.instanceId,
          operationId: '00000000-0000-4000-8000-000000000010',
          requestId: input.requestId,
          sequence: 0,
          finalTargetReleaseId: input.targetReleaseId,
          finalTargetDigest: input.targetDigest,
          state: 'preparing',
          acceptedAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          currentStageIndex: 0,
          stages: [
            {
              releaseId: input.targetReleaseId,
              targetDigest: input.targetDigest,
              attemptId: null,
              state: 'pending',
            },
          ],
          percent: null,
          reason: null,
        };
        return HttpResponse.json(accepted);
      }),
    );
    const first = ui();
    const notice = await screen.findByTestId('upgrade-notice');
    const button = within(notice).getByRole('button', { name: '立即升级' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(lookups.length).toBeGreaterThan(0);
    });
    expect(posts).toHaveLength(1);
    expect(
      within(screen.getByTestId('upgrade-notice')).getByText('正在确认升级请求'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    first.unmount();
    ui();
    await waitFor(() => {
      expect(lookups.length).toBeGreaterThan(1);
    });
    act(lookupGate.release);
    await screen.findAllByText('正在升级到最终版本');
    expect(new Set(lookups)).toEqual(new Set([posts[0]?.requestId]));
    expect(posts).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '刷新页面' })).not.toBeInTheDocument();
  });
  it('available read-only does not deploy or focus; same-day closing spans changed targets and remount', async () => {
    let status = freshStatus();
    status.capabilities.canUpgradeInstance = false;
    const deploy = vi.fn();
    const checks = vi.fn();
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () => {
        checks();
        return HttpResponse.json({ ...status, observedAt: new Date().toISOString() });
      }),
      http.post(`${API}/api/system/upgrade/requests`, () => {
        deploy();
        return HttpResponse.error();
      }),
    );
    const mounted = ui();
    screen.getByRole('textbox', { name: '正在输入' }).focus();
    await screen.findByTestId('upgrade-notice');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '正在输入' }));
    expect(screen.queryByRole('button', { name: '立即升级' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '今天不再提醒' }));
    expect(screen.queryByTestId('upgrade-notice')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '版本与更新' })).toBeVisible();
    expect(screen.getByTestId('upgrade-available-dot')).toBeVisible();
    status = {
      ...status,
      catalog: {
        ...status.catalog,
        availableRelease: { ...status.catalog.availableRelease!, releaseId: '0.2.6' },
      },
    };
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => {
      expect(checks).toHaveBeenCalledTimes(2);
    });
    expect(deploy).not.toHaveBeenCalled();
    mounted.unmount();
    ui();
    await screen.findByRole('button', { name: '版本与更新' });
    expect(screen.queryByTestId('upgrade-notice')).not.toBeInTheDocument();
    expect(deploy).not.toHaveBeenCalled();
  });
  it('an authenticated visit upgrades directly only on explicit click with exact target, CSRF and one request', async () => {
    let status = freshStatus();
    status.capabilities.canUpgradeInstance = true;
    const requests: UpgradeRequest[] = [];
    const grants = vi.fn();
    server.use(
      http.post(`${API}/api/system/upgrade/access`, () => {
        grants();
        return HttpResponse.error();
      }),
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json({ ...status, observedAt: new Date().toISOString() }),
      ),
      http.post(`${API}/api/system/upgrade/requests`, async ({ request }) => {
        expect(request.headers.get('X-Upgrade-CSRF')).toBe(status.csrfToken);
        expect(request.credentials).toBe('include');
        const body = UpgradeRequestSchema.parse(await request.json());
        requests.push(body);
        status = {
          ...status,
          attempt: {
            ...attemptFixture(),
            requestId: body.requestId,
            acceptedAt: new Date().toISOString(),
            observedAt: new Date().toISOString(),
            percent: 45,
            completedWork: 45,
            stage: '检查与迁移',
          },
        };
        return HttpResponse.json(status.attempt, { status: 202 });
      }),
    );
    ui();
    const notice = await screen.findByTestId('upgrade-notice');
    expect(status.capabilities.canAuthenticate).toBe(false);
    expect(requests).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '授权升级' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('实例升级授权密钥')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const button = within(notice).getByRole('button', { name: '立即升级' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findAllByRole('progressbar');
    expect(requests).toHaveLength(1);
    expect(grants).not.toHaveBeenCalled();
    expect(requests[0]).toMatchObject({
      targetDigest: upgradeFixture().catalog.availableRelease?.targetDigest,
      targetReleaseId: '0.2.5',
      expectedActivationGeneration: 7,
    });
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '45');
    expect(screen.queryByRole('button', { name: '刷新页面' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-available-dot')).not.toBeInTheDocument();
  });
  it('closing, checking and reloading an authenticated available version never starts installation', async () => {
    const status = freshStatus();
    const deploy = vi.fn();
    const grants = vi.fn();
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json({ ...status, observedAt: new Date().toISOString() }),
      ),
      http.post(`${API}/api/system/upgrade/access`, () => {
        grants();
        return HttpResponse.error();
      }),
      http.post(`${API}/api/system/upgrade/requests`, () => {
        deploy();
        return HttpResponse.error();
      }),
    );
    const first = ui();
    await screen.findByTestId('upgrade-notice');
    fireEvent.click(screen.getByRole('button', { name: '今天不再提醒' }));
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
    });
    first.unmount();
    ui();
    await screen.findByRole('button', { name: '立即升级' });
    expect(screen.queryByTestId('upgrade-notice')).not.toBeInTheDocument();
    expect(deploy).not.toHaveBeenCalled();
    expect(grants).not.toHaveBeenCalled();
  });
  it('a lost POST result only looks up the same request rather than reissuing deployment', async () => {
    let status = freshStatus();
    status.capabilities.canUpgradeInstance = true;
    const posts: UpgradeRequest[] = [];
    const lookups: string[] = [];
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json({ ...status, observedAt: new Date().toISOString() }),
      ),
      http.post(`${API}/api/system/upgrade/requests`, async ({ request }) => {
        posts.push(UpgradeRequestSchema.parse(await request.json()));
        return HttpResponse.error();
      }),
      http.get(`${API}/api/system/upgrade/requests/:requestId`, ({ params }) => {
        const requestId = String(params['requestId']);
        lookups.push(requestId);
        status = {
          ...status,
          attempt: { ...attemptFixture(), requestId, observedAt: new Date().toISOString() },
        };
        return HttpResponse.json(status.attempt);
      }),
    );
    ui();
    const notice = await screen.findByTestId('upgrade-notice');
    fireEvent.click(within(notice).getByRole('button', { name: '立即升级' }));
    await screen.findAllByRole('progressbar');
    expect(posts).toHaveLength(1);
    expect(lookups.length).toBeGreaterThan(0);
    expect(new Set(lookups)).toEqual(new Set([posts[0]?.requestId]));
    expect(
      Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.getItem(localStorage.key(index) ?? ''),
      ).join(''),
    ).not.toContain('upgradeKey');
  });
  it('a denied capability never opens a separate authorization flow, even for a legacy status', async () => {
    const status = freshStatus();
    status.capabilities = { canUpgradeInstance: false, canAuthenticate: true };
    const grants = vi.fn();
    const deploy = vi.fn();
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json({ ...status, observedAt: new Date().toISOString() }),
      ),
      http.post(`${API}/api/system/upgrade/access`, () => {
        grants();
        return HttpResponse.error();
      }),
      http.post(`${API}/api/system/upgrade/requests`, () => {
        deploy();
        return HttpResponse.error();
      }),
    );
    ui();
    await screen.findByTestId('upgrade-notice');
    expect(screen.queryByRole('button', { name: '立即升级' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '授权升级' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('实例升级授权密钥')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
    });
    expect(grants).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });
  it('an unauthenticated visit uses the existing instance access gate without exposing an upgrade command', async () => {
    const deploy = vi.fn();
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json(
          { code: 'PASSCODE_REQUIRED', message: '请输入访问口令', retryable: false },
          { status: 401 },
        ),
      ),
      http.post(`${API}/api/system/upgrade/requests`, () => {
        deploy();
        return HttpResponse.error();
      }),
    );
    ui();
    await waitFor(() => {
      expect(useAppStore.getState().accessLocked).toBe(true);
    });
    expect(screen.queryByRole('button', { name: '立即升级' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '授权升级' })).not.toBeInTheDocument();
    expect(deploy).not.toHaveBeenCalled();
  });
  it('session expiry at the explicit upgrade request returns to the same access gate and never retries deployment', async () => {
    const status = freshStatus();
    const requests: UpgradeRequest[] = [];
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json({ ...status, observedAt: new Date().toISOString() }),
      ),
      http.post(`${API}/api/system/upgrade/requests`, async ({ request }) => {
        requests.push(UpgradeRequestSchema.parse(await request.json()));
        return HttpResponse.json(
          { code: 'PASSCODE_REQUIRED', message: '请输入访问口令', retryable: false },
          { status: 401 },
        );
      }),
    );
    ui();
    const notice = await screen.findByTestId('upgrade-notice');
    fireEvent.click(within(notice).getByRole('button', { name: '立即升级' }));
    await waitFor(() => {
      expect(useAppStore.getState().accessLocked).toBe(true);
    });
    expect(requests).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(upgradePendingKey(status.instanceId, status.userScope))).toBeNull();
  });
  it('storage changes close reminders across tabs while retaining the quiet actionable button', async () => {
    const status = freshStatus();
    server.use(http.get(`${API}/api/system/upgrade/status`, () => HttpResponse.json(status)));
    ui();
    await screen.findByTestId('upgrade-notice');
    const key = upgradeReminderKey(status.instanceId, status.userScope);
    const date = new Date();
    const day = `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    localStorage.setItem(key, encodeDismissal(day));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: encodeDismissal(day) }));
    });
    expect(screen.queryByTestId('upgrade-notice')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '版本与更新' })).toBeVisible();
  });
  it('next local day rechecks facts before showing another reminder and never starts an upgrade', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 23, 59, 50));
    let verified = false;
    const check = vi.fn(() => Promise.resolve(verified));
    const { result } = renderHook(() => useUpgradeReminder('instance-a', 'viewer-a', check));
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.showNotice).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(check).toHaveBeenCalledOnce();
    expect(result.current.showNotice).toBe(false);
    verified = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(result.current.showNotice).toBe(true);
  });
  it('IME and unsaved content survive source changes; reload stays an explicit confirmed action', () => {
    const { result } = renderHook(() => useUpgradeLeaveGuard());
    const input = document.createElement('input');
    const form = document.createElement('form');
    form.append(input);
    document.body.append(form);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.compositionStart(input);
    expect(result.current()).toBe('composing');
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.input(input, { target: { value: 'unsaved' } });
    expect(result.current()).toBe('cancelled');
    expect(input).toHaveValue('unsaved');
    form.remove();
  });
});
