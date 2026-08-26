// `ImageManifestDto[]` → 卡片入参 + 版本历史（F21-4 §5.1/§6）。
import { describe, it, expect } from 'vitest';
import {
  PENDING_NOT_JUDGED_MESSAGE,
  cardValidationStatus,
  envRowsFromConfig,
  envSummary,
  groupManifestsByImage,
  manifestToCardInput,
  parseManifestRef,
} from '@/lib/image/imageManifestCards';
import { imageCardModel } from '@/lib/image/imageCardModel';
import type { ImageManifestDto } from '@/types/image';

const DIGEST_A = 'sha256:4b17e0c1f2a34b5c6d7e8f90112233445566778899aabbccddeeff0011223344';
const DIGEST_B = 'sha256:8e05a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d77';
const DIGEST_BASE = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function dto(overrides: Partial<ImageManifestDto> = {}): ImageManifestDto {
  return {
    id: 'm-1',
    imageId: 'img-1',
    imageName: 'docker.io/myrepo/ml-agent',
    isBuiltin: false,
    ref: 'docker.io/myrepo/ml-agent:v1.0',
    version: 'v1.0',
    baseImage: 'docker.io/myrepo/ml-agent',
    digest: DIGEST_A,
    entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
    supportedRuntimes: ['codex'],
    resourceDefaults: { cores: 2, ramMb: 4096, diskMb: 20480 },
    labelsRequired: [],
    // 04 §7 ★血统：这几个夹具都是**第三方镜像**且注册于切片之后，按准入规则它们
    // 必须能证明派生自某张内置锚点，所以这里是 digest 而不是 `null`。
    // `null` 的两种语义（① 内置根镜像 ② 切片前存量行）见 `drizzle/0012`——
    // 想测那两种，用 override 显式写 `derivedFromDigest: null`。
    derivedFromDigest: DIGEST_BASE,
    validationStatus: 'valid',
    validationErrors: null,
    isActive: true,
    imageConfig: null,
    registeredAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parseManifestRef', () => {
  it('tag 形态：拆出 name 与 tag', () => {
    expect(parseManifestRef('docker.io/myrepo/ml-agent:v1.0')).toEqual({
      name: 'docker.io/myrepo/ml-agent',
      tag: 'v1.0',
    });
  });

  it('digest 形态：拆出 name 与 digest，**没有 tag**（天然不漂移）', () => {
    expect(parseManifestRef(`ghcr.io/a/b@${DIGEST_A}`)).toEqual({
      name: 'ghcr.io/a/b',
      digest: DIGEST_A,
    });
  });

  /**
   * ★ **冒号必须从最后一个 `/` 之后开始找。**
   * `localhost:5001/img:v1` 的第一个冒号在 registry host 里；从头找会读成
   * name=`localhost` + tag=`5001/img:v1`——一个指向完全不同镜像的名字。
   * 本仓 boxlite e2e 依赖的本地 `:5001` 源正好是这个形状，于是这个 bug
   * **在别处都不会露头，只在最要紧的地方错**。
   *
   * MUTATION：把 `ref.indexOf(':', lastSlash + 1)` 改成 `ref.indexOf(':')` ⇒ 本条红。
   */
  it('registry host 里的端口号不是 tag（localhost:5001/img:v1）', () => {
    expect(parseManifestRef('localhost:5001/img:v1')).toEqual({
      name: 'localhost:5001/img',
      tag: 'v1',
    });
    // 没有 tag 的那种也不能把端口读成 tag。
    expect(parseManifestRef('localhost:5001/img')).toEqual({ name: 'localhost:5001/img' });
  });

  /**
   * 没有 tag 也没有 digest 时**不补 `latest`**（P21-4 §5 ★「不要给它编一个 tag 显示」）。
   * 后端的同名函数会补，那是为了**解析**；这里是为了**显示**，编一个用户没填过的坐标是假信息。
   */
  it('既无 tag 也无 digest ⇒ 只回 name，不编一个 latest 出来', () => {
    expect(parseManifestRef('myrepo/ml-agent')).toEqual({ name: 'myrepo/ml-agent' });
  });
});

describe('manifestToCardInput', () => {
  it('refDisplay 与 DTO 的 ref 逐字相同（registry 恒空串，不猜一个 docker.io 出来）', () => {
    const model = imageCardModel(manifestToCardInput(dto()), Date.parse('2026-08-04T00:00:00Z'));
    expect(model.refDisplay).toBe('docker.io/myrepo/ml-agent:v1.0');
    expect(model.refKind).toBe('tag');
    expect(model.digestState).toBe('pinned');
    expect(model.canCheckUpdate).toBe(true);
    expect(model.resolvedAtLabel).toBe('解析于 3 天前');
  });

  it('digest 形态：refDisplay 用 `@`，[检查更新] 置灰并说明理由', () => {
    const model = imageCardModel(
      manifestToCardInput(
        dto({ ref: `ghcr.io/a/b@${DIGEST_A}`, version: DIGEST_A, digest: DIGEST_A }),
      ),
    );
    expect(model.refDisplay).toBe(`ghcr.io/a/b@${DIGEST_A}`);
    expect(model.refKind).toBe('digest');
    expect(model.canCheckUpdate).toBe(false);
    expect(model.checkUpdateDisabledReason).toContain('不存在上游漂移');
  });

  /**
   * ★ `validationErrors` 这个字段名是历史包袱：后端 `storedFindings()` 在 **warning 档放的是
   * warnings**、invalid 档才是 errors、其余为 null。照字面把它当 errors 用，⚠️ 档的
   * 后果说明就会以**红色 errors** 的形态出现在一张"可正常使用"的卡上。
   *
   * MUTATION：把映射改成"永远进 errors" ⇒ 第一条 warning 断言红。
   */
  it('warning 档的 findings 进 warnings（不是 errors）', () => {
    const input = manifestToCardInput(
      dto({
        validationStatus: 'warning',
        validationErrors: [
          { path: 'x', code: 'RUNTIME_NOT_PREINSTALLED', message: '未预装 claude-code' },
        ],
      }),
    );
    expect(input.warnings).toEqual(['未预装 claude-code']);
    expect(input.errors).toEqual([]);
  });

  it('invalid 档的 findings 进 errors（不是 warnings）', () => {
    const input = manifestToCardInput(
      dto({
        validationStatus: 'invalid',
        validationErrors: [{ path: 'labels', code: 'IMAGE_TMUX_MISSING', message: '缺少 tmux' }],
      }),
    );
    expect(input.errors).toEqual(['缺少 tmux']);
    expect(input.warnings).toEqual([]);
  });

  /**
   * `pending` 在 P21-4 §5 的矩阵里**没有呈现**，而 DTO 的枚举里有它（列默认值）。
   * 处置：归到 ❌ 档，并用一句话说清"平台还没判过"。
   *
   * 选 ❌ 而不是 ⚠️ 的依据是本仓自己的纪律——**少报是降级，多报是撒谎**：
   * ⚠️ 档的字面意思是「验证通过但有警告」+「可正常使用」，而
   * `selectableImages` 的白名单（valid|warning）**已经**把 pending 挡在向导之外，
   * 说"可正常使用"与事实相反。
   */
  it('pending ⇒ 归 ❌ 档，并明说"平台还没判过"，不冒充一个不存在的结论', () => {
    expect(cardValidationStatus('pending')).toBe('invalid');
    const input = manifestToCardInput(dto({ validationStatus: 'pending' }));
    expect(input.errors).toEqual([PENDING_NOT_JUDGED_MESSAGE]);
    expect(input.errors?.[0]).toContain('还没有');
    // 三档原样透传，不做任何别的改写。
    expect(cardValidationStatus('valid')).toBe('valid');
    expect(cardValidationStatus('warning')).toBe('warning');
    expect(cardValidationStatus('invalid')).toBe('invalid');
  });

  it('digest 是哨兵值 ⇒ 未解析：不产出假哈希，也不把哨兵串带进模型', () => {
    const model = imageCardModel(manifestToCardInput(dto({ digest: 'sha256:unresolved' })));
    expect(model.digestState).toBe('unresolved');
    expect(model.digestShort).toBeUndefined();
    expect(model.digestFull).toBeUndefined();
    expect(JSON.stringify(model)).not.toContain('sha256:unresolved');
    expect(model.canCheckUpdate).toBe(false);
  });
});

describe('groupManifestsByImage', () => {
  const active = dto({ id: 'm-new', digest: DIGEST_B, registeredAt: '2026-08-20T00:00:00.000Z' });
  const old = dto({ id: 'm-old', isActive: false, registeredAt: '2026-05-01T00:00:00.000Z' });

  /**
   * ★ 一张卡 = 同一个 `imageId` 的多行（更新 = INSERT 新行 + 旧行下线，不是就地改）。
   * 卡面是**当前活行**，其余进历史——否则「回滚到旧版本」在界面上没有入口。
   *
   * MUTATION：把 `sorted.find(r => r.isActive)` 改成 `sorted[0]` ⇒ 第一条断言仍绿
   *（活行恰好也是最新的），但下面「全被禁用」与「活行不是最新那行」两条会红。
   */
  it('按 imageId 聚成一张卡：卡面是活行，其余进历史', () => {
    const groups = groupManifestsByImage([old, active]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.face.id).toBe('m-new');
    expect(groups[0]?.history.map((h) => h.id)).toEqual(['m-old']);
  });

  it('活行不是最新注册的那一行时，卡面仍取活行', () => {
    const staleActive = dto({ id: 'm-a', registeredAt: '2026-01-01T00:00:00.000Z' });
    const newerInactive = dto({
      id: 'm-b',
      isActive: false,
      registeredAt: '2026-09-01T00:00:00.000Z',
    });
    const groups = groupManifestsByImage([newerInactive, staleActive]);
    expect(groups[0]?.face.id).toBe('m-a');
    expect(groups[0]?.history.map((h) => h.id)).toEqual(['m-b']);
  });

  /**
   * 全部行都被禁用时**整张卡不能消失**——用户还得能看到它、能重新启用它
   *（启用走 activate，不是 PATCH{isActive:true}）。
   */
  it('一行活的都没有 ⇒ 卡面退回最近注册的那一行（卡不消失）', () => {
    const groups = groupManifestsByImage([
      dto({ id: 'm-1', isActive: false, registeredAt: '2026-01-01T00:00:00.000Z' }),
      dto({ id: 'm-2', isActive: false, registeredAt: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.face.id).toBe('m-2');
    expect(groups[0]?.history.map((h) => h.id)).toEqual(['m-1']);
  });

  it('历史行按注册时间倒序，且带上各自的 digest 短串与 tag', () => {
    const groups = groupManifestsByImage([
      dto({ id: 'm-1', isActive: true, registeredAt: '2026-08-20T00:00:00.000Z' }),
      dto({ id: 'm-2', isActive: false, registeredAt: '2026-01-01T00:00:00.000Z' }),
      dto({ id: 'm-3', isActive: false, registeredAt: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(groups[0]?.history.map((h) => h.id)).toEqual(['m-3', 'm-2']);
    expect(groups[0]?.history[0]?.digestShort).toBe('sha256:4b17e…344');
  });

  it('历史行的 digest 未解析 ⇒ digestShort 缺席（view 据此显示「⚠️ 未解析」）', () => {
    const groups = groupManifestsByImage([
      dto({ id: 'm-1' }),
      dto({ id: 'm-2', isActive: false, digest: '' }),
    ]);
    expect(groups[0]?.history[0]?.digestShort).toBeUndefined();
  });

  /**
   * ⚠️ 同一个 `imageId` 可以有**多行都是活的**（唯一索引管的是每个 **tag** 一行活的）。
   * 此时卡面取最近注册的那一行活行，另一行照样出现在历史里——不是"把一行藏起来"。
   */
  it('同一张镜像的多个 tag 都活着：卡面取最近的那一行，另一行仍列在历史里', () => {
    const v1 = dto({ id: 'm-v1', version: 'v1', registeredAt: '2026-01-01T00:00:00.000Z' });
    const v2 = dto({ id: 'm-v2', version: 'v2', registeredAt: '2026-08-01T00:00:00.000Z' });
    const groups = groupManifestsByImage([v1, v2]);
    expect(groups[0]?.face.id).toBe('m-v2');
    expect(groups[0]?.history.map((h) => h.id)).toEqual(['m-v1']);
    expect(groups[0]?.history[0]?.isActive).toBe(true);
  });

  it('排序 ✅ > ⚠️ > ❌，同档按注册时间倒序（pending 与 ❌ 同档）', () => {
    const groups = groupManifestsByImage([
      dto({ id: 'a', imageId: 'i-a', validationStatus: 'invalid' }),
      dto({ id: 'b', imageId: 'i-b', validationStatus: 'valid' }),
      dto({ id: 'c', imageId: 'i-c', validationStatus: 'warning' }),
      dto({ id: 'd', imageId: 'i-d', validationStatus: 'pending' }),
    ]);
    expect(groups.map((g) => g.imageId)).toEqual(['i-b', 'i-c', 'i-a', 'i-d']);
  });

  it('空列表不抛错', () => {
    expect(groupManifestsByImage([])).toEqual([]);
  });
});

describe('envRowsFromConfig / envSummary', () => {
  /**
   * ★ 后端把已存 secret 的 value 掩码成 `''`（I-IMG-5），而空 value 在入站方向的含义是
   * **保持不变**。两者对上了 ⇒ `secretStored:true` ⇒ 输入框渲染空 + 「保持不变，输入即覆盖」，
   * 于是"打开面板直接保存"是一次无操作，而不是把所有 secret 清空。
   */
  it('secret 行 ⇒ secretStored:true，value 是后端掩码后的空串', () => {
    const rows = envRowsFromConfig({
      env: [
        { key: 'LOG_LEVEL', value: 'info', secret: false },
        { key: 'MY_SECRET', value: '', secret: true },
      ],
    });
    expect(rows).toEqual([
      { id: 'env-0', key: 'LOG_LEVEL', value: 'info', secret: false, secretStored: false },
      { id: 'env-1', key: 'MY_SECRET', value: '', secret: true, secretStored: true },
    ]);
  });

  it('imageConfig 为 null（列表里很常见）⇒ 空表，不抛', () => {
    expect(envRowsFromConfig(null)).toEqual([]);
    expect(envSummary(null)).toBe('');
  });

  /** 摘要里 secret **一律掩码**——原值不进 props、不进 DOM（P21-4 §10.2 安全红线）。 */
  it('摘要把 secret 掩成 ***，明文变量照常显示', () => {
    expect(
      envSummary({
        env: [
          { key: 'LOG_LEVEL', value: 'info', secret: false },
          { key: 'MY_SECRET', value: 'super-secret-value', secret: true },
        ],
      }),
    ).toBe('LOG_LEVEL=info · MY_SECRET=***');
  });
});
