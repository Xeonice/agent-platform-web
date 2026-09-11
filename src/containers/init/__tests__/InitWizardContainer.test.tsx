// 向导容器的**文案回归**用例（F21-8 §3）。
//
// ⭐ 它守的是一类很便宜、也很容易再犯的缺陷：**同一个事实在同屏出现两次，其中一次是硬编码的。**
// 第 5 步的标题句此前写着「预留 15% 只影响调度上限」，而同一屏下方的 `reservedText` 取的是
// 后端下发的 `dto.disk.reservedPercent` —— 后端改这个值，标题那句当场变假，而没有任何测试会红。
//
// ⚠️ 用例把 `reservedPercent` 设成 **25**（刻意不是 15）：这样"硬编码的 15"与"跟着后端走的 25"
// 会在同一屏上互相打脸，断言 `不含 15%` 才抓得住它。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { InitWizardContainer } from '@/containers/init/InitWizardContainer';
import type { InitStatusDto, SystemResourcesDto, SystemSettingsDto } from '@/types/system';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const GB = 1024 ** 3;

/** 三条历史结果**全通过** ⇒ 进向导不重跑检测，且代理那一步被跳过（少一次点击）。 */
const HISTORY: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
  { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
  { target: 'localhost:5001', ok: true, latencyMs: 6, modelApi: false },
];

const STATUS: InitStatusDto = {
  initialized: false,
  lastConnectivityCheck: HISTORY,
  lastConnectivityCheckAt: '2026-08-29T16:11:34.000Z',
};

const SETTINGS: SystemSettingsDto = {
  initialized: false,
  accessPasscodeEnabled: false,
  version: { platform: 'dev', node: 'v22.22.0' },
};

/** ⚠️ `reservedPercent: 25` —— 见文件头，这个数字是本文件的判据。 */
const RESOURCES: SystemResourcesDto = {
  cpu: { cores: 10, loadAvg1m: 3.7, usedPercent: 37, level: 'ok' },
  ram: { totalBytes: 32 * GB, usedBytes: 24 * GB, usedPercent: 76.7, level: 'ok' },
  disk: {
    path: '/data',
    totalBytes: 200 * GB,
    usedBytes: 120 * GB,
    availableBytes: 80 * GB,
    usedPercent: 60,
    level: 'ok',
    reservedPercent: 25,
  },
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 0,
};

function serve(): void {
  server.use(
    http.get(`${API_BASE}/api/system/init-status`, () => HttpResponse.json(STATUS)),
    http.get(`${API_BASE}/api/system/settings`, () => HttpResponse.json(SETTINGS)),
    http.get(`${API_BASE}/api/system/resources`, () => HttpResponse.json(RESOURCES)),
  );
}

function renderWizard(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<InitWizardContainer />, { wrapper: Wrapper });
}

/**
 * 一路点到最后一步（出网全通过 ⇒ 代理那一步自动跳过）。
 *
 * ⚠️ 按钮上的字**按步变**（就绪时是 [下一步]、未就绪时是 [稍后配置，下一步]），所以这里
 * 认的是"底部那颗前进按钮"而不是一串写死的文案 —— 写死的话，第 3/4 步的就绪状态一变
 * 这个 helper 就假红，而它跟本文件要守的东西毫无关系。
 */
async function walkToLastStep(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    if (screen.queryByTestId('resource-confirm') !== null) break;
    const next = await screen.findByRole('button', { name: /下一步$/ });
    fireEvent.click(next);
  }
  await waitFor(() => {
    expect(screen.getByTestId('resource-confirm')).toBeInTheDocument();
  });
}

describe('InitWizardContainer · 同屏不许有第二份事实', () => {
  beforeEach(() => {
    serve();
  });
  afterEach(cleanup);

  /**
   * ⛔ **标题句里硬编码「预留 15%」** —— 后端一改 `reservedPercent`，它当场变成假话，
   * 而同一屏下方那行说的是真值，两个数字直接打架。
   *
   * MUTATION：把 description 改回「预留 15% 只影响调度上限…」⇒ 本条红。
   */
  it('⭐ 第 5 步：标题句不出现任何百分比，具体比例只由后端下发的那一行说', async () => {
    renderWizard();
    await walkToLastStep();

    // 后端说 25%，屏幕上就该是 25%。
    const reserved = await screen.findByTestId('resource-reserved');
    expect(reserved).toHaveTextContent('总容量的 25%');
    const wizard = screen.getByTestId('init-wizard');
    // ⛔ 硬编码的那个 15% 一处都不许出现。
    expect(wizard).not.toHaveTextContent('15%');
    // 「预留只影响可调度上限、不影响进度条分母」这条事实要留着 —— 删掉数字不等于删掉意思。
    expect(wizard).toHaveTextContent('进度条');
  });

  /**
   * ⭐ **第一屏的第一行字**要说得出"要做什么、多长"。原文只有「平台初始化」四个字。
   * ⛔ 不许承诺时间（"约 5 分钟"是编的）：说得出的是**步数**。
   */
  it('⭐ 首屏标题给出步数与「哪一步要离开这一页」，⛔ 不承诺时间', async () => {
    renderWizard();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('共 5 步');
    expect(heading).not.toHaveTextContent('分钟');
    expect(screen.getByTestId('init-wizard')).toHaveTextContent(
      '只有配模型帐号那一步需要你离开这一页',
    );
  });
});
