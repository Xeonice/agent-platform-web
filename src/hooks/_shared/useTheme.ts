'use client';
// 主题偏好的读写 + 把它同步到 `<html>` 上（design-notes §4 Phase 5 第 3 条）。
//
// ⚠️ **首屏那一次不归这里管**：偏好存在 localStorage，而本 hook 要等 React 水合才跑得起来
// —— 那时第一帧早画完了。首帧前的应用在 `app/layout.tsx` 的内联 `<script>` 里，
// 那段与这里是**同一套判定**（system → 看 `prefers-color-scheme`；否则用存的值）。
// ⛔ 改了一处就要改另一处，否则会出现"刷新后是亮的、切一下变暗的"这种自相矛盾。
//
// 本 hook 负责的是**运行期**：用户点了切换、或系统主题在页面开着时变了。
import { useEffect } from 'react';
import { useAppStore } from '@/stores';

export type ThemePreference = 'system' | 'dark' | 'light';

export interface UseThemeResult {
  /** 用户的偏好（可能是 `system`）。 */
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

/** `system` 偏好下当前实际该用哪个。 */
function resolveSystem(): 'dark' | 'light' {
  // ⚠️ 判据写成"是不是亮色"而不是"是不是暗色"：`matchMedia` 在不支持的环境里返回
  // `matches: false`，那时我们要落到**暗色**（产品默认，P21 §3），而不是亮色。
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function useTheme(): UseThemeResult {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  useEffect(() => {
    const apply = (): void => {
      const effective = theme === 'system' ? resolveSystem() : theme;
      document.documentElement.classList.toggle('dark', effective !== 'light');
    };
    apply();

    // ⚠️ 只在 `system` 偏好下才跟着系统变。用户显式选了 dark/light 之后，
    // ⛔ 系统切主题不该把他的选择顶掉 —— 那是"我明明选了亮色，它自己变暗了"。
    if (theme !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
    };
  }, [theme]);

  return { theme, setTheme };
}
