// 后端 400 envelope → 环境变量逐行红字（F21-4 §7.1 的五条 + §8.3 的 ⓪）。
import { describe, it, expect } from 'vitest';
import { mapEnvErrorResponse } from '@/lib/image/mapEnvErrorResponse';

const DUP = { path: 'env[2].key', code: 'ENV_DUPLICATE_KEY', message: '变量名重复' };

describe('mapEnvErrorResponse', () => {
  /**
   * ★ ⓪ **只读 `details[].code`，顶层 `code` 连看都不看。**
   * 四个 `ENV_*` 永远住在 `details[]` 里，顶层恒为 `VALIDATION_FAILED`——
   * 拿顶层去查这四个码永远不命中，而不命中不会让任何测试变红。
   *
   * MUTATION：把判据改成读顶层 `code` ⇒ 本条红（顶层是 `VALIDATION_FAILED`，
   * 不在四码白名单里 ⇒ 一行都归不了位）。
   */
  it('顶层是 VALIDATION_FAILED 也照样归位——判据在 details[].code 上', () => {
    const mapped = mapEnvErrorResponse({ message: '运行参数不合法', details: [DUP] }, 5);
    expect(mapped.rowErrors).toEqual([
      { index: 2, field: 'key', code: 'ENV_DUPLICATE_KEY', path: 'env[2].key' },
    ]);
    expect(mapped.unmapped).toEqual([]);
  });

  it('① 按 path 归位到对应行与字段（key / value 分得开）', () => {
    const mapped = mapEnvErrorResponse(
      {
        message: '',
        details: [
          { path: 'env[0].key', code: 'ENV_NAME_RESERVED', message: '保留名' },
          { path: 'env[3].value', code: 'ENV_LIMIT_EXCEEDED', message: '值超长' },
        ],
      },
      5,
    );
    expect(mapped.rowErrors).toEqual([
      { index: 0, field: 'key', code: 'ENV_NAME_RESERVED', path: 'env[0].key' },
      { index: 3, field: 'value', code: 'ENV_LIMIT_EXCEEDED', path: 'env[3].value' },
    ]);
  });

  it('整表级 path（`env`）⇒ field:"rows"，与前端预检同形', () => {
    const mapped = mapEnvErrorResponse(
      {
        message: '',
        details: [{ path: 'env', code: 'ENV_LIMIT_EXCEEDED', message: '超过 50 条' }],
      },
      60,
    );
    expect(mapped.rowErrors).toEqual([{ field: 'rows', code: 'ENV_LIMIT_EXCEEDED', path: 'env' }]);
  });

  /**
   * ② 未知 code **不丢**：`EnvVarEditor.view` 的 `ERROR_COPY` 只认四个码，
   * 把第五个码塞进 `rowErrors` 会渲染出一行 `undefined`。所以它进 `unmapped`，
   * 由容器连同 envelope 的 message 一起做整体提示。
   *
   * MUTATION：把未知码也 push 进 `rowErrors` ⇒ 第二条断言红。
   */
  it('② 未知 code ⇒ 不进逐行红字，但也不丢（走 unmapped + 整体提示）', () => {
    const mapped = mapEnvErrorResponse(
      {
        message: '运行参数不合法',
        details: [{ path: 'env[0].key', code: 'ENV_SOMETHING_NEW', message: '后端加的新码' }],
      },
      3,
    );
    expect(mapped.rowErrors).toEqual([]);
    expect(mapped.unmapped).toHaveLength(1);
    expect(mapped.generalMessage).toBe('运行参数不合法');
  });

  /** ③ path 指向已经被删掉的行：忽略但不崩，并且照样露头（不静默吞）。 */
  it('③ path 指向已删除的行 ⇒ 不归位（不会标错行），进 unmapped', () => {
    const mapped = mapEnvErrorResponse({ message: '不合法', details: [DUP] }, 2);
    expect(mapped.rowErrors).toEqual([]);
    expect(mapped.unmapped).toEqual([DUP]);
    expect(mapped.generalMessage).toBe('不合法');
  });

  /** path 形状不认识（后端换了写法）同样进 unmapped，而不是被解析成 NaN 行。 */
  it('path 形状不认识 ⇒ unmapped，绝不产出 NaN 行号', () => {
    const mapped = mapEnvErrorResponse(
      {
        message: 'x',
        details: [{ path: 'imageConfig.env.2.key', code: 'ENV_NAME_INVALID', message: 'm' }],
      },
      5,
    );
    expect(mapped.rowErrors).toEqual([]);
    expect(mapped.unmapped).toHaveLength(1);
  });

  /**
   * ④ `details` 缺失/为空 ⇒ 退化为整体提示（用 envelope 的 message），**不静默吞掉**。
   * 吞掉的表现是：后端拒了，界面一片安静，用户以为保存成功了。
   */
  it('④ details 缺席 ⇒ 整体提示用 envelope 的 message', () => {
    expect(mapEnvErrorResponse({ message: '保存被拒绝' }, 3)).toEqual({
      rowErrors: [],
      unmapped: [],
      generalMessage: '保存被拒绝',
    });
    expect(mapEnvErrorResponse({ message: '保存被拒绝', details: [] }, 3).generalMessage).toBe(
      '保存被拒绝',
    );
  });

  it('details 里混着形状不对的项（非对象 / 空对象）⇒ 跳过，不崩', () => {
    const mapped = mapEnvErrorResponse({ message: 'x', details: [{}, DUP] }, 5);
    expect(mapped.rowErrors).toHaveLength(1);
  });

  it('全部归位成功时不产生整体提示（不要在逐行红字之上再叠一句泛泛的话）', () => {
    const mapped = mapEnvErrorResponse({ message: '运行参数不合法', details: [DUP] }, 5);
    expect(mapped.generalMessage).toBeUndefined();
  });
});
