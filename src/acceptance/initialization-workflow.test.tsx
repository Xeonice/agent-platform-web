import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { API, NOW, body, deferred, online, resources, runtime } from './support/fixtures';
import { mount } from './support/mount';
import { InitWizardContainer } from '@/containers/init/InitWizardContainer';
import { systemKeys } from '@/hooks/system/useAuditStream';

function diagnostic(preset = 'ok') {
  return [
    {
      event: 'start',
      checks: [
        { id: 'outbound-network', label: '联网检查' },
        { id: 'preset-image', label: '预制镜像' },
      ],
      timeoutMs: 10000,
    },
    {
      event: 'check',
      id: 'outbound-network',
      label: '联网检查',
      status: 'ok',
      headline: '联网正常',
      durationMs: 150,
      detail: { results: online },
    },
    {
      event: 'check',
      id: 'preset-image',
      label: '预制镜像',
      status: preset === 'ok' ? 'ok' : 'fail',
      step: preset === 'ok' ? 'staged' : 'registry',
      headline: preset === 'ok' ? '镜像已就绪' : '镜像下载源里找不到这张镜像',
      durationMs: 150,
      ...(preset === 'ok'
        ? {}
        : {
            errorCode: 'PRESET_IMAGE_NOT_IN_REGISTRY',
            command: 'docker push ghcr.io/agent-infra/sandbox:latest',
          }),
    },
    { event: 'done', okCount: 2, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 300 },
  ];
}
function sse(frames: unknown[]) {
  return new HttpResponse(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
function base() {
  server.use(
    http.get(`${API}/api/system/init-status`, () =>
      HttpResponse.json({
        initialized: false,
        lastConnectivityCheck: online,
        lastConnectivityCheckAt: NOW,
      }),
    ),
    http.get(`${API}/api/runtimes`, () => HttpResponse.json([runtime()])),
    http.post(`${API}/api/system/diagnose`, () => sse(diagnostic())),
  );
}
const next = () => fireEvent.click(screen.getByRole('button', { name: /^(稍后配置，)?下一步$/ }));
async function resourceStep() {
  next();
  await screen.findByTestId('preset-step-staged');
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
  });
  next();
  await screen.findByTestId('subscription-setup');
  next();
  await screen.findByTestId('resource-confirm');
}
describe('DEP · initialization owns the gate until explicit successful finish', () => {
  it('REQ-DEP-005: historical connectivity renders immediately without starting a diagnostic', async () => {
    base();
    const diagnosis = vi.fn();
    server.use(
      http.post(`${API}/api/system/diagnose`, () => {
        diagnosis();
        return sse(diagnostic());
      }),
    );
    mount(<InitWizardContainer />);
    await screen.findByTestId('connectivity-check');
    expect(diagnosis).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('connectivity-check')).toHaveTextContent('上次检测');
    });
    expect(screen.getByTestId('init-step-proxy')).toHaveTextContent('可跳过');
  });
  it('REQ-DEP-007/008: model APIs all unreachable requires explicit acknowledgement; timeouts alone do not declare offline', async () => {
    base();
    server.use(
      http.get(`${API}/api/system/init-status`, () =>
        HttpResponse.json({
          initialized: false,
          lastConnectivityCheck: online.map((row) => ({ ...row, ok: false, hint: 'DNS 解析不了' })),
          lastConnectivityCheckAt: NOW,
        }),
      ),
    );
    mount(<InitWizardContainer />);
    await screen.findByTestId('offline-notice');
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    const verdict = screen.getByTestId('connectivity-verdict').textContent;
    expect(screen.getByTestId('offline-notice')).not.toHaveTextContent(verdict);
    fireEvent.click(screen.getByRole('button', { name: '我知道，继续' }));
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
    expect(screen.getByTestId('connectivity-check')).toBeInTheDocument();
  });
  it('REQ-DEP-010/012: before preset conclusion primary is blocked; registry failure leaves later steps unchecked and skip available', async () => {
    base();
    const gate = deferred();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    server.use(
      http.post(
        `${API}/api/system/diagnose`,
        () =>
          new HttpResponse(
            new ReadableStream<Uint8Array>({
              start(value) {
                controller = value;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(diagnostic()[0])}\n\n`));
                void gate.promise.then(() => {
                  for (const frame of diagnostic('registry').slice(1))
                    value.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
                  value.close();
                });
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );
    mount(<InitWizardContainer />);
    await screen.findByTestId('connectivity-check');
    next();
    await screen.findByTestId('preset-step-config');
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    act(gate.release);
    const skip = await screen.findByRole('button', { name: '稍后配置，下一步' });
    expect(controller).toBeDefined();
    expect(screen.getByTestId('preset-step-registry')).toHaveTextContent('未通过');
    expect(screen.getByTestId('preset-step-lineage')).toHaveTextContent('未检查');
    expect(skip).toHaveAttribute('aria-describedby', 'preset-image-blocked');
    fireEvent.click(skip);
    expect(screen.getByTestId('init-step-preset-image')).toHaveAttribute('data-skipped', 'true');
  });
  it('REQ-DEP-014/015: successful finish is the only init write, low resources remain advisory, and reserved ratio is real', async () => {
    base();
    const init = vi.fn();
    server.use(
      http.get(`${API}/api/system/resources`, () =>
        HttpResponse.json({
          ...resources,
          disk: { ...resources.disk, availableBytes: 38 * 1024 ** 3 },
        }),
      ),
      http.post(`${API}/api/system/init`, async ({ request }) => {
        init(await body(request));
        return HttpResponse.json({ initialized: true, initializedAt: NOW }, { status: 201 });
      }),
    );
    const { client } = mount(<InitWizardContainer />);
    await screen.findByTestId('connectivity-check');
    await resourceStep();
    const finish = screen.getByRole('button', { name: '确认，开始使用' });
    expect(screen.getByTestId('resource-confirm')).not.toContainElement(finish);
    await waitFor(() => {
      expect(screen.getByTestId('resource-confirm')).toHaveTextContent('25%');
    });
    expect(screen.getByTestId('resource-confirm')).toHaveTextContent('仍可继续');
    expect(init).not.toHaveBeenCalled();
    fireEvent.click(finish);
    await waitFor(() => {
      expect(client.getQueryData<{ initialized: boolean }>(systemKeys.init())?.initialized).toBe(
        true,
      );
    });
    expect(init).toHaveBeenCalledOnce();
  });
  it('REQ-DEP-016: init write failure keeps the resource step and enables a deliberate retry', async () => {
    base();
    const requests = vi.fn();
    server.use(
      http.post(`${API}/api/system/init`, () => {
        requests();
        return HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: '写入失败：数据目录只读。', retryable: true },
          { status: 500 },
        );
      }),
    );
    const { client } = mount(<InitWizardContainer />);
    await screen.findByTestId('connectivity-check');
    await resourceStep();
    fireEvent.click(screen.getByRole('button', { name: '确认，开始使用' }));
    await screen.findByText('初始化没有完成');
    expect(screen.getByTestId('resource-confirm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认，开始使用' })).toBeEnabled();
    expect(client.getQueryData<{ initialized: boolean }>(systemKeys.init())?.initialized).toBe(
      false,
    );
    expect(requests).toHaveBeenCalledOnce();
  });
});
