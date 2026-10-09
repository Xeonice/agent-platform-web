import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import { ImagesContainer } from '@/containers/image/ImagesContainer';
import { imageKeys, useImages } from '@/hooks/image/useImages';
import { mount } from '@/acceptance/support/mount';
import { server } from '@/acceptance/support/server';
import { API, body, deferred, NOW } from '@/acceptance/support/fixtures';
import type { ImageManifestDto, ValidationOutcomeDto } from '@/types/image';

const image = (extra: Partial<ImageManifestDto> = {}): ImageManifestDto => ({
  id: 'manifest-current',
  imageId: 'image-agent',
  imageName: 'registry.test/agent',
  imageAlias: null,
  version: 'v1',
  ref: 'registry.test/agent:v1',
  digest: `sha256:${'a'.repeat(64)}`,
  isBuiltin: false,
  isActive: true,
  derivedFromDigest: `sha256:${'b'.repeat(64)}`,
  baseImage: 'registry.test/platform-base',
  entrypointContract: { workdir: '/', entrypoint: ['/bin/sh'] },
  resourceDefaults: { cores: 1, ramMb: 512, diskMb: 1024 },
  labelsRequired: [],
  supportedRuntimes: ['codex', 'claude-code'],
  validationStatus: 'valid',
  validationErrors: [],
  registeredAt: NOW,
  resolvedAt: NOW,
  imageConfig: {
    env: [
      { key: 'LOG_LEVEL', value: 'info', secret: false },
      { key: 'TOKEN', value: '', secret: true },
    ],
  },
  ...extra,
});
const valid: ValidationOutcomeDto = {
  status: 'valid',
  digest: `sha256:${'a'.repeat(64)}`,
  errors: [],
  warnings: [],
};

async function edit(id = 'manifest-current') {
  const card = await screen.findByTestId('image-card');
  expect(card).toHaveAttribute('data-image-id', id);
  const trigger = within(card).getByRole('button', { name: '编辑别名' });
  fireEvent.click(trigger);
  const input = within(card).getByRole('textbox', { name: '镜像别名' });
  await waitFor(() => {
    expect(input).toHaveFocus();
  });
  return { card, trigger, input, editor: within(card).getByTestId('image-alias-editor') };
}

async function registration(ref: string) {
  const trigger = screen.getAllByRole('button', { name: '+ 注册新镜像' })[0];
  if (trigger === undefined) throw new Error('Missing registration button');
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '注册新镜像' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '镜像 URI' }), {
    target: { value: ref },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '验证' }));
  await waitFor(() => {
    expect(within(dialog).getByRole('button', { name: '保存' })).toBeEnabled();
  });
  return dialog;
}

function VariantQueries() {
  useImages('codex', 'aio');
  useImages('claude-code', 'boxlite');
  return null;
}

describe('IMG-060/061 别名编辑、缓存与坐标身份', () => {
  it('保存后刷新全部活跃变体与历史缓存，只改同一 Image 的别名', async () => {
    let rows = [
      image(),
      image({
        id: 'manifest-old',
        version: 'v0',
        ref: 'registry.test/agent:v0',
        isActive: false,
        registeredAt: '2026-10-04T00:00:00.000Z',
      }),
      image({
        id: 'manifest-other',
        imageId: 'image-other',
        imageName: 'registry.test/other',
        ref: 'registry.test/other:v1',
        imageAlias: '另一个环境',
      }),
    ];
    const original = structuredClone(rows);
    const reads = new Map<string, number>();
    const writes: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API}/api/images`, ({ request }) => {
        const key = new URL(request.url).search;
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return HttpResponse.json(rows);
      }),
      http.patch(`${API}/api/images/:id`, async ({ request }) => {
        const payload = await body(request);
        writes.push(payload);
        const alias = typeof payload['alias'] === 'string' ? payload['alias'] : null;
        rows = rows.map((row) =>
          row.imageId === 'image-agent' ? { ...row, imageAlias: alias } : row,
        );
        return HttpResponse.json(rows.find((row) => row.id === 'manifest-current'));
      }),
    );
    const { client } = mount(
      <>
        <ImagesContainer />
        <VariantQueries />
      </>,
    );
    const inactiveKey = imageKeys.list('shell', 'legacy');
    client.setQueryDefaults(inactiveKey, { gcTime: Infinity });
    client.setQueryData(inactiveKey, original);
    await waitFor(() => {
      expect(reads.size).toBe(3);
    });
    const card = (await screen.findAllByTestId('image-card')).find(
      (node) => node.getAttribute('data-image-id') === 'manifest-current',
    );
    if (card === undefined) throw new Error('Missing current image card');
    fireEvent.click(within(card).getByRole('button', { name: '编辑别名' }));
    fireEvent.change(within(card).getByRole('textbox', { name: '镜像别名' }), {
      target: { value: '  研发 🚀  ' },
    });
    fireEvent.click(within(card).getByRole('button', { name: '保存别名' }));
    await waitFor(() => {
      expect(screen.queryByTestId('image-alias-editor')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect([...reads.values()]).toEqual([2, 2, 2]);
    });
    expect(writes).toEqual([{ alias: '研发 🚀' }]);
    const expected = original.map((row) =>
      row.imageId === 'image-agent' ? { ...row, imageAlias: '研发 🚀' } : row,
    );
    for (const key of [
      imageKeys.list(),
      imageKeys.list('codex', 'aio'),
      imageKeys.list('claude-code', 'boxlite'),
      inactiveKey,
    ])
      expect(client.getQueryData(key)).toEqual(expected);
    expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    expect(within(card).getByRole('heading')).toHaveTextContent('研发 🚀');
    expect(card).toHaveTextContent('registry.test/agent:v1');
    expect(rows).toEqual(expected);
  });

  it('取消和 Esc 放弃草稿并归还焦点；清除直到保存才提交 null', async () => {
    let row = image({ imageAlias: '原别名' });
    const writes: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json([row])),
      http.patch(`${API}/api/images/:id`, async ({ request }) => {
        writes.push(await body(request));
        row = { ...row, imageAlias: null };
        return HttpResponse.json(row);
      }),
    );
    mount(<ImagesContainer />);
    const first = await edit();
    fireEvent.change(first.input, { target: { value: '未保存草稿' } });
    fireEvent.click(within(first.editor).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(first.trigger).toHaveFocus();
    });
    expect(screen.queryByTestId('image-alias-editor')).not.toBeInTheDocument();
    const second = await edit();
    expect(second.input).toHaveValue('原别名');
    fireEvent.change(second.input, { target: { value: '另一个草稿' } });
    fireEvent.keyDown(second.input, { key: 'Escape' });
    await waitFor(() => {
      expect(second.trigger).toHaveFocus();
    });
    expect(writes).toEqual([]);
    const third = await edit();
    fireEvent.click(within(third.editor).getByRole('button', { name: '清除别名' }));
    expect(third.input).toHaveValue('');
    expect(within(third.card).getByRole('heading')).toHaveTextContent('原别名');
    expect(writes).toEqual([]);
    fireEvent.click(within(third.editor).getByRole('button', { name: '保存别名' }));
    await waitFor(() => {
      expect(screen.queryByTestId('image-alias-editor')).not.toBeInTheDocument();
    });
    expect(writes).toEqual([{ alias: null }]);
    expect(within(third.card).getByRole('heading')).toHaveTextContent('registry.test/agent:v1');
  });

  it('65 码点与原始粘贴控制字符不能提交，64 码点保存期间锁定编辑和 Esc', async () => {
    const gate = deferred();
    let row = image();
    const writes: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json([row])),
      http.patch(`${API}/api/images/:id`, async ({ request }) => {
        const payload = await body(request);
        writes.push(payload);
        await gate.promise;
        row = {
          ...row,
          imageAlias: typeof payload['alias'] === 'string' ? payload['alias'] : null,
        };
        return HttpResponse.json(row);
      }),
    );
    mount(<ImagesContainer />);
    const { input, editor } = await edit();
    fireEvent.change(input, { target: { value: '🚀'.repeat(65) } });
    expect(within(editor).getByRole('alert')).toHaveTextContent('别名最多 64 个字符');
    expect(within(editor).getByRole('button', { name: '保存别名' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.paste(input, { clipboardData: { getData: () => '\n研发' } });
    expect(within(editor).getByRole('alert')).toHaveTextContent('别名不能包含换行或控制字符');
    expect(writes).toEqual([]);
    fireEvent.change(input, { target: { value: '🚀'.repeat(64) } });
    expect(editor).toHaveTextContent('64/64');
    fireEvent.click(within(editor).getByRole('button', { name: '保存别名' }));
    await waitFor(() => {
      expect(input).toBeDisabled();
    });
    expect(within(editor).getByRole('button', { name: '取消' })).toBeDisabled();
    expect(within(editor).getByRole('button', { name: '清除别名' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('image-alias-editor')).toBeInTheDocument();
    gate.release();
    await waitFor(() => {
      expect(screen.queryByTestId('image-alias-editor')).not.toBeInTheDocument();
    });
    expect(writes).toEqual([{ alias: '🚀'.repeat(64) }]);
  });

  it('失败保留原别名与草稿，可原位重试成功', async () => {
    let row = image({ imageAlias: '原别名' });
    let calls = 0;
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json([row])),
      http.patch(`${API}/api/images/:id`, async ({ request }) => {
        const payload = await body(request);
        if (++calls === 1)
          return HttpResponse.json(
            {
              code: 'SAVE_FAILED',
              message: '保存失败，请重试',
              retryable: true,
              sideEffectFree: true,
            },
            { status: 503 },
          );
        row = {
          ...row,
          imageAlias: typeof payload['alias'] === 'string' ? payload['alias'] : null,
        };
        return HttpResponse.json(row);
      }),
    );
    const success = vi.spyOn(toast, 'success');
    mount(<ImagesContainer />);
    const { input, editor, card } = await edit();
    fireEvent.change(input, { target: { value: '重试草稿' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存别名' }));
    await within(editor).findByRole('alert');
    expect(input).toHaveValue('重试草稿');
    expect(within(card).getByRole('heading')).toHaveTextContent('原别名');
    expect(success).not.toHaveBeenCalled();
    fireEvent.click(within(editor).getByRole('button', { name: '保存别名' }));
    await waitFor(() => {
      expect(screen.queryByTestId('image-alias-editor')).not.toBeInTheDocument();
    });
    expect(within(card).getByRole('heading')).toHaveTextContent('重试草稿');
    expect(calls).toBe(2);
  });

  it.each(['missing', 'different'] as const)(
    '200 响应别名 %s 时不得宣称成功或更改缓存',
    async (mode) => {
      const row = image({ imageAlias: '原别名' });
      let reads = 0;
      const legacy = Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== 'imageAlias'),
      );
      server.use(
        http.get(`${API}/api/images`, () => {
          reads++;
          return HttpResponse.json([row]);
        }),
        http.patch(`${API}/api/images/:id`, () =>
          HttpResponse.json(mode === 'missing' ? legacy : row),
        ),
      );
      const success = vi.spyOn(toast, 'success');
      const { client } = mount(<ImagesContainer />);
      const { input, editor, card } = await edit();
      fireEvent.change(input, { target: { value: '新草稿' } });
      fireEvent.click(within(editor).getByRole('button', { name: '保存别名' }));
      await waitFor(() => {
        expect(within(editor).getByRole('alert')).toHaveTextContent('服务未确认镜像别名');
      });
      expect(input).toHaveValue('新草稿');
      expect(within(card).getByRole('heading')).toHaveTextContent('原别名');
      expect(client.getQueryData(imageKeys.list())).toEqual([row]);
      expect(reads).toBe(1);
      expect(success).not.toHaveBeenCalled();
    },
  );

  it('改名使卡片不匹配时保留管理搜索并归还搜索焦点', async () => {
    let row = image({ imageAlias: '旧环境' });
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json([row])),
      http.patch(`${API}/api/images/:id`, async ({ request }) => {
        const payload = await body(request);
        row = { ...row, imageAlias: String(payload['alias']) };
        return HttpResponse.json(row);
      }),
    );
    mount(<ImagesContainer />);
    await screen.findByTestId('image-card');
    const search = screen.getByRole('searchbox', { name: '搜索镜像' });
    fireEvent.change(search, { target: { value: ' 旧环境 ' } });
    const { input, editor } = await edit();
    fireEvent.change(input, { target: { value: '新环境' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存别名' }));
    await waitFor(() => {
      expect(screen.queryByTestId('image-card')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(search).toHaveFocus();
    });
    expect(search).toHaveValue(' 旧环境 ');
    fireEvent.change(search, { target: { value: '新环境' } });
    expect(await screen.findByTestId('image-card')).toHaveTextContent('新环境');
  });

  it('允许不同 Image 重名并显示真实坐标，HTML 形态别名作为普通文本', async () => {
    const alias = '<img src=x onerror=alert(1)>';
    server.use(
      http.get(`${API}/api/images`, () =>
        HttpResponse.json([
          image({ imageAlias: alias }),
          image({
            id: 'other',
            imageId: 'other',
            imageName: 'registry.test/other',
            ref: 'registry.test/other:v2',
            imageAlias: alias,
          }),
        ]),
      ),
    );
    mount(<ImagesContainer />);
    const cards = await screen.findAllByTestId('image-card');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByRole('heading')).toHaveTextContent(alias);
      expect(card.querySelector('img')).toBeNull();
    }
    expect(cards.map((card) => card.textContent).join(' ')).toContain('registry.test/agent:v1');
    expect(cards.map((card) => card.textContent).join(' ')).toContain('registry.test/other:v2');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索镜像' }), {
      target: { value: '<img' },
    });
    expect(screen.getAllByTestId('image-card')).toHaveLength(2);
  });
});

describe('IMG-060 注册的可选别名', () => {
  it.each(['', '   '])('注册别名 %j 省略字段，别名修改不使已验证 URI 失效', async (alias) => {
    let rows: ImageManifestDto[] = [];
    let validations = 0;
    const writes: Record<string, unknown>[] = [];
    const created = image({
      id: 'registered',
      imageId: 'registered-image',
      imageName: 'registry.test/new',
      ref: 'registry.test/new:v1',
    });
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json(rows)),
      http.post(`${API}/api/images/validate`, () => {
        validations++;
        return HttpResponse.json(valid);
      }),
      http.post(`${API}/api/images`, async ({ request }) => {
        writes.push(await body(request));
        rows = [created];
        return HttpResponse.json({ manifest: created, validation: valid }, { status: 201 });
      }),
    );
    mount(<ImagesContainer />);
    await screen.findByTestId('images-empty');
    const dialog = await registration(created.ref);
    fireEvent.change(within(dialog).getByRole('textbox', { name: '别名（可选）' }), {
      target: { value: alias },
    });
    expect(within(dialog).getByTestId('validation-result')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('conclusion-invalidated')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '注册新镜像' })).not.toBeInTheDocument();
    });
    expect(writes).toEqual([{ ref: created.ref }]);
    expect(validations).toBe(1);
    expect(await screen.findByTestId('image-card')).toHaveTextContent(created.ref);
  });

  it('新镜像发送 trim 别名并显示返回值，alias 编辑不重新验证 URI', async () => {
    let rows: ImageManifestDto[] = [];
    let validations = 0;
    const writes: Record<string, unknown>[] = [];
    const created = image({
      id: 'registered',
      imageId: 'registered-image',
      imageName: 'registry.test/new',
      ref: 'registry.test/new:v1',
      imageAlias: '联调环境',
    });
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json(rows)),
      http.post(`${API}/api/images/validate`, () => {
        validations++;
        return HttpResponse.json(valid);
      }),
      http.post(`${API}/api/images`, async ({ request }) => {
        writes.push(await body(request));
        rows = [created];
        return HttpResponse.json({ manifest: created, validation: valid }, { status: 201 });
      }),
    );
    mount(<ImagesContainer />);
    await screen.findByTestId('images-empty');
    const dialog = await registration(created.ref);
    fireEvent.change(within(dialog).getByRole('textbox', { name: '别名（可选）' }), {
      target: { value: '  联调环境  ' },
    });
    expect(within(dialog).getByRole('button', { name: '保存' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '注册新镜像' })).not.toBeInTheDocument();
    });
    expect(writes).toEqual([{ ref: created.ref, alias: '联调环境' }]);
    expect(validations).toBe(1);
    expect(within(await screen.findByTestId('image-card')).getByRole('heading')).toHaveTextContent(
      '联调环境',
    );
  });

  it('已有镜像不同 alias 的字段错误保留输入和验证，定位现有卡而不改名', async () => {
    const row = image({ imageAlias: '已保存别名' });
    let validations = 0;
    let writes = 0;
    let patches = 0;
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json([row])),
      http.post(`${API}/api/images/validate`, () => {
        validations++;
        return HttpResponse.json(valid);
      }),
      http.post(`${API}/api/images`, () => {
        writes++;
        return HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: '请在镜像卡片编辑别名',
            retryable: false,
            sideEffectFree: true,
            details: [{ path: 'alias', message: '请在镜像卡片编辑别名' }],
          },
          { status: 400 },
        );
      }),
      http.patch(`${API}/api/images/:id`, () => {
        patches++;
        return HttpResponse.json(row);
      }),
    );
    const { client } = mount(<ImagesContainer />);
    await screen.findByTestId('image-card');
    const dialog = await registration('registry.test/agent:v2');
    const alias = within(dialog).getByRole('textbox', { name: '别名（可选）' });
    fireEvent.change(alias, { target: { value: '新名字' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(alias).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('请在镜像卡片编辑别名');
    expect(alias).toHaveValue('新名字');
    expect(within(dialog).getByTestId('validation-result')).toBeInTheDocument();
    expect(client.getQueryData(imageKeys.list())).toEqual([row]);
    expect(writes).toBe(1);
    expect(patches).toBe(0);
    expect(validations).toBe(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '定位到该镜像' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '注册新镜像' })).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('image-card-slot')).toHaveAttribute('data-highlighted', 'true');
    expect(within(screen.getByTestId('image-card')).getByRole('heading')).toHaveTextContent(
      '已保存别名',
    );
  });
});
