import { describe, it, expect } from 'vitest';
import {
  imageCardModel,
  shortenDigest,
  digestStateOf,
  refKindOf,
  formatResolvedAt,
  UNRESOLVED_DIGEST_SENTINEL,
  CHECK_UPDATE_DISABLED_DIGEST_REF,
  CHECK_UPDATE_DISABLED_UNRESOLVED,
} from '@/lib/image/imageCardModel';
import type { ImageCardInput } from '@/types/image';

const NOW = Date.parse('2026-08-25T12:00:00.000Z');
const DAY = 24 * 3600 * 1000;

/** 真实长度的 digest：`sha256:` + 64 位十六进制 = 71 字符（F21-4 §5.1「全串 71 字符」）。 */
const FULL_DIGEST = `sha256:4b17e${'f'.repeat(56)}a02`;

/** tag 形态、已钉定 digest、⚠️ 警告档的自定义镜像；**不带** lastValidatedAt（各用例自行叠加）。 */
const baseTagImage: ImageCardInput = {
  id: 'img-1',
  name: 'ml-agent',
  ref: { registry: 'docker.io', repository: 'myrepo/ml-agent', tag: 'v1.0', digest: FULL_DIGEST },
  validationStatus: 'warning',
  supportedRuntimes: ['codex'],
  isActive: true,
  isBuiltin: false,
};

const tagImage: ImageCardInput = {
  ...baseTagImage,
  lastValidatedAt: new Date(NOW - 3 * DAY).toISOString(),
  warnings: ['未预装 claude-code，创建时需现装，实测约 12.5 分钟'],
};

describe('imageCardModel · digest 呈现（F21-4 §7.1 ①②，§5.1）', () => {
  it('① 截断展示为「前 12 + 尾 3」，全串另存供展开/复制', () => {
    expect(FULL_DIGEST).toHaveLength(71);
    const model = imageCardModel(tagImage, NOW);
    // 前 12 = 'sha256:'（7）+ 5 位十六进制。
    expect(model.digestShort).toBe('sha256:4b17e…a02');
    expect(model.digestShort).toHaveLength(12 + 1 + 3);
    expect(model.digestFull).toBe(FULL_DIGEST);
    expect(model.digestState).toBe('pinned');
  });

  it('① 串本身不比「前 12 + 尾 3」长时原样返回，不制造自我重叠的假截断', () => {
    // 15 字符 = 12 + 3，正好压线 ⇒ 原样返回。
    expect(shortenDigest('sha256:abcdefgh')).toBe('sha256:abcdefgh');
    // 16 字符 ⇒ 才开始截：前 12 'sha256:abcde' + 尾 3 'ghi'。
    expect(shortenDigest('sha256:abcdefghi')).toBe('sha256:abcde…ghi');
  });

  it('② 空串 digest → digestState:"unresolved" 且 canCheckUpdate:false，且不产出假哈希/空串', () => {
    const model = imageCardModel({ ...tagImage, ref: { ...tagImage.ref, digest: '' } }, NOW);
    expect(model.digestState).toBe('unresolved');
    expect(model.canCheckUpdate).toBe(false);
    expect(model.checkUpdateDisabledReason).toBe(CHECK_UPDATE_DISABLED_UNRESOLVED);
    // 「不产出假哈希、不产出空串」：两个字段都必须**缺席**，而不是给个 '' 让 view 留白。
    expect(model).not.toHaveProperty('digestShort');
    expect(model).not.toHaveProperty('digestFull');
  });

  it('② 哨兵值 sha256:unresolved 同样判 unresolved，且哨兵串不进模型（不漏给用户看）', () => {
    const model = imageCardModel(
      { ...tagImage, ref: { ...tagImage.ref, digest: UNRESOLVED_DIGEST_SENTINEL } },
      NOW,
    );
    expect(model.digestState).toBe('unresolved');
    expect(model.canCheckUpdate).toBe(false);
    expect(JSON.stringify(model)).not.toContain(UNRESOLVED_DIGEST_SENTINEL);
  });

  it('② digest 字段整个缺席时也判 unresolved（契约说非空，但今天写它的是硬编码哨兵）', () => {
    expect(digestStateOf(undefined)).toBe('unresolved');
    const model = imageCardModel(
      { ...tagImage, ref: { registry: 'docker.io', repository: 'myrepo/ml-agent', tag: 'v1.0' } },
      NOW,
    );
    expect(model.digestState).toBe('unresolved');
    expect(model.canCheckUpdate).toBe(false);
  });
});

describe('imageCardModel · 解析时间（F21-4 §7.1 ③）', () => {
  it('③ lastValidatedAt 缺席 → 不产出时间行（而不是「解析于 NaN 前」）', () => {
    const model = imageCardModel(baseTagImage, NOW);
    expect(model).not.toHaveProperty('resolvedAtLabel');
    expect(JSON.stringify(model)).not.toContain('NaN');
  });

  it('③ lastValidatedAt 为空串 / 非法日期串 → 同样不产出时间行', () => {
    expect(formatResolvedAt('', NOW)).toBeUndefined();
    expect(formatResolvedAt('昨天下午', NOW)).toBeUndefined();
    const model = imageCardModel({ ...baseTagImage, lastValidatedAt: 'not-a-date' }, NOW);
    expect(model).not.toHaveProperty('resolvedAtLabel');
  });

  it('措辞是「解析于」而不是「最后验证」（P21-4 §3 裁决），分钟/小时/天各一档', () => {
    expect(imageCardModel(tagImage, NOW).resolvedAtLabel).toBe('解析于 3 天前');
    expect(formatResolvedAt(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW)).toBe(
      '解析于 5 分钟前',
    );
    expect(formatResolvedAt(new Date(NOW - 3 * 3600 * 1000).toISOString(), NOW)).toBe(
      '解析于 3 小时前',
    );
    expect(formatResolvedAt(new Date(NOW - 2000).toISOString(), NOW)).toBe('解析于 刚刚');
    // 时钟偏移导致的「未来」不该变成负数天。
    expect(formatResolvedAt(new Date(NOW + 60 * 1000).toISOString(), NOW)).toBe('解析于 刚刚');
  });
});

describe('imageCardModel · ref 形态与两颗按钮的分工（F21-4 §7.1 ④，§5.1）', () => {
  it('④ ref 形如 repo@sha256:… → refKind:"digest" 且 canCheckUpdate:false（无 tag 无漂移）', () => {
    const digestRef: ImageCardInput = {
      ...tagImage,
      ref: { registry: 'docker.io', repository: 'myrepo/ml-agent', digest: FULL_DIGEST },
    };
    expect(refKindOf(digestRef.ref)).toBe('digest');
    const model = imageCardModel(digestRef, NOW);
    expect(model.refKind).toBe('digest');
    expect(model.canCheckUpdate).toBe(false);
    // **置灰并说明理由**，不隐藏——隐藏会让人以为这张卡少了个功能。
    expect(model.checkUpdateDisabledReason).toBe(CHECK_UPDATE_DISABLED_DIGEST_REF);
    expect(model.refDisplay).toBe(`docker.io/myrepo/ml-agent@${FULL_DIGEST}`);
  });

  it('tag 形态 + digest 已钉定 → canCheckUpdate:true 且没有置灰理由', () => {
    const model = imageCardModel(tagImage, NOW);
    expect(model.refKind).toBe('tag');
    expect(model.canCheckUpdate).toBe(true);
    expect(model).not.toHaveProperty('checkUpdateDisabledReason');
    expect(model.refDisplay).toBe('docker.io/myrepo/ml-agent:v1.0');
  });

  it('digest 形态 + 未解析：refDisplay 不拼哨兵串，也不为它编一个 tag（P21-4 §5 ★）', () => {
    const model = imageCardModel(
      {
        ...tagImage,
        ref: {
          registry: 'docker.io',
          repository: 'myrepo/ml-agent',
          digest: UNRESOLVED_DIGEST_SENTINEL,
        },
      },
      NOW,
    );
    expect(model.refDisplay).toBe('docker.io/myrepo/ml-agent');
    expect(model.refDisplay).not.toContain('latest');
    expect(model.canCheckUpdate).toBe(false);
  });
});

describe('imageCardModel · 其余派生与否定断言（F21-4 §7.1 ⑤）', () => {
  it('预置镜像不给 [删除]，自定义镜像给（P21-4 §9）', () => {
    expect(imageCardModel({ ...tagImage, isBuiltin: true }, NOW).canDelete).toBe(false);
    expect(imageCardModel(tagImage, NOW).canDelete).toBe(true);
  });

  it('warnings / errors 缺席时归一为空数组，view 不必再判 undefined', () => {
    const model = imageCardModel(baseTagImage, NOW);
    expect(model.warnings).toEqual([]);
    expect(model.errors).toEqual([]);
    expect(imageCardModel(tagImage, NOW).warnings).toHaveLength(1);
  });

  it('⑤ 否定断言：模型上不许出现任何「结论过期」字段（钉定 digest 之后结论不会烂）', () => {
    const stale = imageCardModel(
      { ...tagImage, lastValidatedAt: new Date(NOW - 400 * DAY).toISOString() },
      NOW,
    );
    // 400 天前解析的镜像，结论仍然是它自己的三级结论——不转黄、不加过期标记。
    expect(stale.validationStatus).toBe('warning');
    expect(stale.resolvedAtLabel).toBe('解析于 400 天前');
    expect(stale).not.toHaveProperty('staleValidation');
    expect(stale).not.toHaveProperty('isStale');
    expect(stale).not.toHaveProperty('validationExpiresAt');
    // 兜住「换个名字偷偷长回来」：任何带 stale/expire/outdated/fresh 语义的键都不许存在。
    expect(Object.keys(stale).filter((k) => /stale|expir|outdat|fresh|rotten/i.test(k))).toEqual(
      [],
    );
  });
});
