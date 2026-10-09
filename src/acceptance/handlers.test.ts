import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handlers, resetImageFixtures } from '@/mocks/handlers';
import { saveImageAlias } from '@/services/api/image.service';
import type { ImageManifestDto, RegisterImageResponseDto } from '@/types/image';
import { server } from './support/server';
import { API } from './support/fixtures';

beforeEach(() => {
  resetImageFixtures();
  server.use(...handlers);
});
afterEach(() => {
  resetImageFixtures();
});

function write(path: string, method: 'POST' | 'PATCH', body: object): Promise<Response> {
  // eslint-disable-next-line no-restricted-syntax -- Raw mock-contract requests intentionally include invalid DTO fields rejected by typed service calls.
  return fetch(`${API}/api/images${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function images(query = ''): Promise<ImageManifestDto[]> {
  // eslint-disable-next-line no-restricted-syntax -- Test the default mock's persisted HTTP response independently of production service decoding.
  const response = await fetch(`${API}/api/images${query}`);
  expect(response.status).toBe(200);
  const rows: ImageManifestDto[] = await response.json();
  return rows;
}

describe('default dev MSW image aliases follow the generated API contract', () => {
  it('keeps POST 201, returns normalized alias and exposes the registration in later GETs', async () => {
    const response = await write('', 'POST', {
      ref: 'docker.io/myrepo/new-agent:v2.0',
      alias: '  构建 Agent  ',
    });
    expect(response.status).toBe(201);
    const result: RegisterImageResponseDto = await response.json();
    expect(result.manifest).toMatchObject({
      id: 'img-manifest-new',
      imageId: 'img-new',
      imageAlias: '构建 Agent',
      ref: 'docker.io/myrepo/new-agent:v2.0',
    });
    expect(await images()).toContainEqual(result.manifest);
    const withoutAlias = await write('', 'POST', { ref: 'registry.test/plain:v1' });
    expect(withoutAlias.status).toBe(201);
    expect((await withoutAlias.json()).manifest.imageAlias).toBeNull();
  });

  it('PATCH updates every version of the same Image without mutating other fixture fields', async () => {
    const before = await images();
    const response = await write('/img-manifest-3', 'PATCH', { alias: '  研发环境  ' });
    expect(response.status).toBe(200);
    expect((await response.json()).imageAlias).toBe('研发环境');
    const after = await images();
    expect(after.filter((row) => row.imageId === 'img-2').map((row) => row.imageAlias)).toEqual([
      '研发环境',
      '研发环境',
    ]);
    expect(after.map((row) => ({ ...row, imageAlias: null }))).toEqual(before);
    for (const query of ['?provider=aio', '?runtimeId=codex']) {
      expect((await images(query)).find((row) => row.id === 'img-manifest-2')?.imageAlias).toBe(
        '研发环境',
      );
    }
  });

  it('supports the strict production save response check, Unicode limits, clearing and omission', async () => {
    expect((await saveImageAlias('img-manifest-2', '😀'.repeat(64))).imageAlias).toBe(
      '😀'.repeat(64),
    );
    const unchanged = await write('/img-manifest-2', 'PATCH', { isActive: false });
    expect((await unchanged.json()).imageAlias).toBe('😀'.repeat(64));
    const cleared = await write('/img-manifest-3', 'PATCH', { alias: '    ' });
    expect((await cleared.json()).imageAlias).toBeNull();
    expect(
      (await images())
        .filter((row) => row.imageId === 'img-2')
        .every((row) => row.imageAlias === null),
    ).toBe(true);
    await saveImageAlias('img-manifest-2', '原值');
    expect((await saveImageAlias('img-manifest-3', null)).imageAlias).toBeNull();
  });

  it.each([
    '😀'.repeat(65),
    '\tAgent',
    'Agent\n',
    '\rAgent',
    '\u0000Agent',
    '\u0085Agent',
    '\u2028Agent',
    'Agent\u2029',
    42,
  ])('rejects invalid raw alias with real field-error shape and no writes: %s', async (alias) => {
    await saveImageAlias('img-manifest-2', '原值');
    const before = await images();
    for (const [path, method, body] of [
      ['/img-manifest-2', 'PATCH', { alias }],
      ['', 'POST', { ref: 'registry.test/rejected:v1', alias }],
    ] as const) {
      const response = await write(path, method, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        retryable: false,
        sideEffectFree: true,
        details: [{ path: 'alias' }],
      });
    }
    expect(await images()).toEqual(before);
  });

  it('permits duplicate aliases on distinct Image identities without hiding their real references', async () => {
    await saveImageAlias('img-manifest-1', '研发环境');
    await saveImageAlias('img-manifest-2', '研发环境');
    const rows = await images();
    expect(rows.find((row) => row.imageId === 'img-1')).toMatchObject({
      imageAlias: '研发环境',
      ref: 'ghcr.io/agent-infra/sandbox:latest',
    });
    expect(rows.find((row) => row.imageId === 'img-2')).toMatchObject({
      imageAlias: '研发环境',
      ref: 'docker.io/myrepo/ml-agent:v1.0',
    });
  });

  it('retains PATCH-enable 400 and rejects missing alias targets without pretending a save succeeded', async () => {
    const before = await images();
    const enable = await write('/img-manifest-2', 'PATCH', { isActive: true, alias: '不能提交' });
    expect(enable.status).toBe(400);
    expect(await enable.json()).toMatchObject({ code: 'BAD_REQUEST' });
    const missing = await write('/missing-manifest', 'PATCH', { alias: '不能提交' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'NOT_FOUND', sideEffectFree: true });
    expect(await images()).toEqual(before);
  });

  it('resets only mutable image fixture state for repeatable tests', async () => {
    const baseline = await images();
    await saveImageAlias('img-manifest-1', '预制环境');
    await write('', 'POST', { ref: 'registry.test/transient:v1', alias: '临时' });
    expect(await images()).not.toEqual(baseline);
    resetImageFixtures();
    expect(await images()).toEqual(baseline);
  });
});
