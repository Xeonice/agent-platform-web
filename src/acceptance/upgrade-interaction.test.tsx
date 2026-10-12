import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { mount } from './support/mount';
import { API } from './support/fixtures';
import { InstanceUpgradeProviderContainer } from '@/containers/system/InstanceUpgradeProviderContainer';
import { VersionUpdateContainer } from '@/containers/system/VersionUpdateContainer';
import { VersionUpdateCardContainer } from '@/containers/system/VersionUpdateCardContainer';
import { UpgradeRequestSchema } from '@/types/upgrade-contract';
import { attemptFixture, upgradeFixture } from '@/mocks/upgrade';
import { useUpgradeReminder } from '@/hooks/system/useUpgradeReminder';
import { useUpgradeLeaveGuard } from '@/hooks/system/useUpgradeLeaveGuard';
import { encodeDismissal, upgradeReminderKey } from '@/lib/system/upgradeReminderPreference';
import type { UpgradeRequest } from '@/types/upgrade';
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
  it('available read-only does not deploy or focus; same-day closing spans changed targets and remount', async () => {
    let status = freshStatus();
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
  it('only an explicit authorized command posts once with exact digest/generation and then reads fixed progress', async () => {
    let status = freshStatus();
    status.capabilities.canUpgradeInstance = true;
    const requests: UpgradeRequest[] = [];
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () =>
        HttpResponse.json({ ...status, observedAt: new Date().toISOString() }),
      ),
      http.post(`${API}/api/system/upgrade/requests`, async ({ request }) => {
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
    expect(requests).toHaveLength(0);
    const button = within(notice).getByRole('button', { name: '立即升级' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findAllByRole('progressbar');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      targetDigest: upgradeFixture().catalog.availableRelease?.targetDigest,
      targetReleaseId: '0.2.5',
      expectedActivationGeneration: 7,
    });
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '45');
    expect(screen.queryByRole('button', { name: '刷新页面' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-available-dot')).not.toBeInTheDocument();
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
  it('the independent upgrade key is requested only by explicit system-card authorization and immediately cleared', async () => {
    const status = freshStatus();
    const grants: unknown[] = [];
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () => HttpResponse.json(status)),
      http.post(`${API}/api/system/upgrade/access`, async ({ request }) => {
        grants.push(await request.json());
        return HttpResponse.json({
          ...status,
          capabilities: { canAuthenticate: true, canUpgradeInstance: true },
          csrfToken: 'new-test-csrf',
        });
      }),
    );
    ui();
    await screen.findByTestId('upgrade-notice');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '授权升级' }));
    const dialog = await screen.findByRole('dialog', { name: '授权本实例升级' });
    const input = within(dialog).getByLabelText('实例升级授权密钥');
    fireEvent.change(input, { target: { value: 'test-independent-upgrade-key' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '授权升级' }));
    expect(input).toHaveValue('');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(grants).toEqual([{ upgradeKey: 'test-independent-upgrade-key' }]);
    expect(window.location.href).not.toContain('test-independent-upgrade-key');
    expect(
      Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.getItem(localStorage.key(index) ?? ''),
      ).join(''),
    ).not.toContain('test-independent-upgrade-key');
    expect(screen.getAllByRole('button', { name: '立即升级' }).length).toBeGreaterThan(0);
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
