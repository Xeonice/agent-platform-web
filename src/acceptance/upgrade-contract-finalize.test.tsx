import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { mount } from './support/mount';
import { API } from './support/fixtures';
import { InstanceUpgradeProviderContainer } from '@/containers/system/InstanceUpgradeProviderContainer';
import { useInstanceUpgradeContext, UPGRADE_STATUS_KEY } from '@/hooks/system/useInstanceUpgrade';
import { useContractFinalize } from '@/hooks/system/useContractFinalize';
import { ContractFinalizeView } from '@/views/system/ContractFinalize.view';
import { deriveContractFinalize, contractPendingKey } from '@/lib/system/contractFinalizeModel';
import { receiveUpgradeStatus } from '@/lib/system/upgradeModel';
import { upgradeFixture, UPGRADE_TEST_TIME, DIGEST_B } from '@/mocks/upgrade';
import {
  UpgradeStatusSchema,
  UpgradeContractAttemptSchema,
  UpgradeContractRequestSchema,
  type UpgradeContractRequest,
} from '@/types/upgrade-contract';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const now = Date.parse(UPGRADE_TEST_TIME);
function status() {
  const source = upgradeFixture();
  return UpgradeStatusSchema.parse({
    ...source,
    capabilities: { ...source.capabilities, canContract: true },
    contract: {
      authority: 'legacy',
      availablePlan: {
        planDigest: DIGEST_B,
        releaseId: source.confirmedServiceRelease?.releaseId,
        expandPlanDigest: DIGEST_B,
        rollbackWindowClosesAt: new Date(now - 60000).toISOString(),
        eligible: true,
        reason: null,
        legacyReaderCount: 1,
        irreversible: true,
      },
      attempt: null,
    },
  });
}
function attempt(state: string) {
  return UpgradeContractAttemptSchema.parse({
    instanceId: 'instance-a',
    contractAttemptId: '3b49f27d-3a95-4b9a-9f47-17fbdfbd5e04',
    requestId: 'a71b6e7a-2cd5-4afc-9b75-70ef97616b0b',
    targetPlanDigest: DIGEST_B,
    activationGeneration: 7,
    sequence: 2,
    state,
    stage: 'real server contract phase',
    completedRows: 2,
    totalRows: null,
    acceptedAt: UPGRADE_TEST_TIME,
    observedAt: UPGRADE_TEST_TIME,
    reason: null,
  });
}
describe('UPG independent semantic contract UI facts', () => {
  it('requires fresh explicit server capability and eligible plan on the actual confirmed release', () => {
    const source = status();
    expect(deriveContractFinalize(source, false, now).canExecute).toBe(true);
    source.capabilities.canContract = false;
    expect(deriveContractFinalize(source, false, now).canExecute).toBe(false);
    source.capabilities.canContract = true;
    expect(deriveContractFinalize(source, true, now).canExecute).toBe(false);
    expect(deriveContractFinalize(source, false, now + 6000).canExecute).toBe(false);
    expect(deriveContractFinalize(source, false, now - 6000).canExecute).toBe(false);
    if (!source.contract?.availablePlan) throw new Error('test plan missing');
    source.contract.availablePlan.releaseId = '9.9.9';
    expect(deriveContractFinalize(source, false, now).canExecute).toBe(false);
  });
  it.each(['accepted', 'retiring-readers', 'authority-active', 'clearing', 'unknown'])(
    'does not create another request while the original state is %s',
    (state) => {
      const source = status();
      if (!source.contract) throw new Error('test contract missing');
      source.contract.attempt = attempt(state);
      const model = deriveContractFinalize(source, false, now);
      expect(model.canExecute).toBe(false);
      expect(model.facts.find((fact) => fact.label === '已清理行数')?.value).toBe('2 / 待确认');
    },
  );
  it('keeps absent and unknown authority separate from permission or completion', () => {
    expect(deriveContractFinalize(null, false, now).visible).toBe(false);
    const source = status();
    if (!source.contract) throw new Error('test contract missing');
    source.contract.authority = 'unknown';
    expect(deriveContractFinalize(source, false, now).canExecute).toBe(false);
    source.contract.authority = 'new';
    expect(deriveContractFinalize(source, false, now)).toMatchObject({
      canExecute: false,
      status: '当前数据格式已成为权威',
    });
  });
  it('isolates public request bookmarks by instance and viewer without authorization data', () => {
    expect(contractPendingKey('instance-a', 'viewer-a')).not.toBe(
      contractPendingKey('instance-b', 'viewer-a'),
    );
    expect(contractPendingKey('instance-a', 'viewer-a')).not.toBe(
      contractPendingKey('instance-a', 'viewer-b'),
    );
  });
  it('discards late contract sequences and blocks conflicting progress or irreversible authority reversal', () => {
    const source = status();
    if (!source.contract) throw new Error('test contract missing');
    source.contract.attempt = { ...attempt('clearing'), sequence: 5, completedRows: 4 };
    const initial = receiveUpgradeStatus(null, source, now);
    const late = structuredClone(source);
    if (!late.contract?.attempt) throw new Error('test contract attempt missing');
    late.contract.attempt.sequence = 4;
    late.observedAt = new Date(now + 100).toISOString();
    expect(receiveUpgradeStatus(initial, late, now + 100)).toBe(initial);
    late.contract.attempt.sequence = 5;
    late.contract.attempt.completedRows = 3;
    expect(receiveUpgradeStatus(initial, late, now + 100).uncertain).toBe(true);
    source.contract.authority = 'new';
    const irreversible = receiveUpgradeStatus(null, source, now);
    const reverted = structuredClone(source);
    if (!reverted.contract) throw new Error('test contract missing');
    reverted.contract.authority = 'legacy';
    reverted.observedAt = new Date(now + 100).toISOString();
    const rejected = receiveUpgradeStatus(irreversible, reverted, now + 100);
    expect(rejected.uncertain).toBe(true);
    expect(rejected.snapshot?.contract?.authority).toBe('new');
  });
});
function ContractHarness() {
  const controller = useInstanceUpgradeContext();
  const contract = useContractFinalize(controller);
  return (
    <>
      <ContractFinalizeView {...contract} />
      <button
        onClick={() => {
          void controller?.check();
        }}
      >
        检查清理状态
      </button>
    </>
  );
}
function ui() {
  return mount(
    <InstanceUpgradeProviderContainer>
      <ContractHarness />
    </InstanceUpgradeProviderContainer>,
  );
}
function freshResponse(source: ReturnType<typeof status>) {
  return { ...source, observedAt: new Date().toISOString() };
}
describe('UPG F: independent contract command through actual Web networking', () => {
  it('opening/checking is read-only; explicit confirmation sends one fixed-plan authorized CAS request', async () => {
    const source = status(),
      requests: UpgradeContractRequest[] = [];
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () => HttpResponse.json(freshResponse(source))),
      http.post(`${API}/api/system/upgrade/contracts/requests`, async ({ request }) => {
        expect(request.headers.get('X-Upgrade-CSRF')).toBe(source.csrfToken);
        const body = UpgradeContractRequestSchema.parse(await request.json());
        requests.push(body);
        const accepted = {
          ...attempt('accepted'),
          requestId: body.requestId,
          targetPlanDigest: body.targetPlanDigest,
        };
        if (!source.contract) throw new Error('test contract missing');
        source.contract.attempt = accepted;
        return HttpResponse.json(accepted, { status: 202 });
      }),
    );
    ui();
    fireEvent.click(await screen.findByRole('button', { name: '清理旧数据格式' }));
    expect(requests).toHaveLength(0);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '确认清理' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]).toMatchObject({
      targetPlanDigest: DIGEST_B,
      expectedActivationGeneration: 7,
      acknowledgeRollbackClosure: true,
    });
    await screen.findByText('清理请求已受理');
    expect(localStorage.getItem(contractPendingKey('instance-a', 'viewer-a'))).toBeNull();
  });
  it('network uncertainty and remount only look up the original public request ID, never send a second command', async () => {
    const source = status(),
      requests: UpgradeContractRequest[] = [],
      lookups: string[] = [];
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () => HttpResponse.json(freshResponse(source))),
      http.post(`${API}/api/system/upgrade/contracts/requests`, async ({ request }) => {
        requests.push(UpgradeContractRequestSchema.parse(await request.json()));
        return HttpResponse.error();
      }),
      http.get(`${API}/api/system/upgrade/contracts/requests/:requestId`, ({ params }) => {
        lookups.push(String(params['requestId']));
        return HttpResponse.error();
      }),
    );
    const first = ui();
    fireEvent.click(await screen.findByRole('button', { name: '清理旧数据格式' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认清理' }));
    await waitFor(() => {
      expect(lookups.length).toBeGreaterThan(0);
    });
    const stored = localStorage.getItem(contractPendingKey('instance-a', 'viewer-a'));
    expect(stored).toBe(JSON.stringify({ version: 1, requestId: requests[0]?.requestId }));
    const previous = lookups.length;
    first.unmount();
    ui();
    await waitFor(() => {
      expect(lookups.length).toBeGreaterThan(previous);
    });
    expect(new Set(lookups)).toEqual(new Set([requests[0]?.requestId]));
    expect(requests).toHaveLength(1);
  });
  it('server permission loss while confirmation is open refuses submission instead of taking shared access as administrator', async () => {
    const source = status(),
      command = vi.fn();
    server.use(
      http.get(`${API}/api/system/upgrade/status`, () => HttpResponse.json(freshResponse(source))),
      http.post(`${API}/api/system/upgrade/contracts/requests`, () => {
        command();
        return HttpResponse.error();
      }),
    );
    const mounted = ui();
    fireEvent.click(await screen.findByRole('button', { name: '清理旧数据格式' }));
    source.capabilities.canContract = false;
    await act(async () => {
      await mounted.client.refetchQueries({ queryKey: UPGRADE_STATUS_KEY });
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: '确认清理' }),
      ).toBeDisabled();
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认清理' }));
    expect(command).not.toHaveBeenCalled();
  });
});
