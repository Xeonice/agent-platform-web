import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/views/**/*.{ts,tsx}',
    './src/containers/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        background: 'hsl(var(--background))',
        'background-elevated': 'hsl(var(--background-elevated))',
        'background-subtle': 'hsl(var(--background-subtle))',
        foreground: 'hsl(var(--foreground))',
        'foreground-muted': 'hsl(var(--foreground-muted))',
        'foreground-subtle': 'hsl(var(--foreground-subtle))',
        muted: 'hsl(var(--background-subtle))',
        'muted-foreground': 'hsl(var(--foreground-muted))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        // ⚠️ shadcn 组件里的 `accent` 语义是「当前项的低对比底色」，⛔ 不是本仓
        // --accent 那个高饱和强调蓝（焦点环 / 链接）。此前这里直接接到 --accent，
        // 结果是：① `bg-accent` 让菜单焦点项刷成亮蓝；② `text-accent-foreground`
        // 因为没有 .foreground 子键而**根本不存在**、被 Tailwind 静默丢弃 ——
        // 亮蓝底配没被改过的浅灰字，实测对比度 2.8:1，低于 WCAG AA 的 4.5:1。
        // 改成成对映射到 --accent-surface（与 card/popover/secondary 同一写法）。
        // --accent 变量本身不动，它继续服务 --ring。
        accent: {
          DEFAULT: 'hsl(var(--accent-surface))',
          foreground: 'hsl(var(--accent-surface-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        error: 'hsl(var(--error))',
        info: 'hsl(var(--info))',
        timeout: 'hsl(var(--timeout))',
        terminal: 'var(--terminal-bg)',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
