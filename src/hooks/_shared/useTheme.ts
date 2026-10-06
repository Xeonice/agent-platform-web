'use client';
// 主题偏好同步到 html。首帧由 app/layout.tsx 内联脚本应用，运行期由 hook 更新。
// 两处必须共用一致判定：system 跟随 prefers-color-scheme，其它值使用存储偏好。
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
