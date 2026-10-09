import { describe, expect, it } from 'vitest';
import { validateImageAlias } from '@/lib/image/imageAlias';

describe('IMG-060 别名的 Unicode 输入边界', () => {
  it('去首尾空白并按码点计数，空白表示清除', () => {
    expect(validateImageAlias('  研发 🚀  ')).toEqual({ value: '研发 🚀', count: 4 });
    expect(validateImageAlias(' \u3000 ')).toEqual({ value: null, count: 0 });
    expect(validateImageAlias('')).toEqual({ value: null, count: 0 });
  });

  it('64 个 emoji 合法，65 个被拒绝；不把 UTF-16 长度当码点数', () => {
    expect(validateImageAlias('🚀'.repeat(64))).toEqual({ value: '🚀'.repeat(64), count: 64 });
    expect(validateImageAlias('🚀'.repeat(65))).toMatchObject({
      count: 65,
      error: '别名最多 64 个字符',
    });
  });

  it.each(['\n', '\r', '\t', '\u0000', '\u0001', '\u007f', '\u0085', '\u2028', '\u2029'])(
    '原始输入包含 %j 时拒绝，不能先 trim 后绕过检查',
    (control) => {
      expect(validateImageAlias(`${control}研发`)).toMatchObject({
        error: '别名不能包含换行或控制字符',
      });
      expect(validateImageAlias(control)).toMatchObject({ error: '别名不能包含换行或控制字符' });
    },
  );
});
