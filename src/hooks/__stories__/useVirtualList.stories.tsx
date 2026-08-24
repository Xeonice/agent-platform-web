// ⚠️ **这是一个"非视图"的 story，刻意为之**（12 §2.2 的分层：Storybook 是唯一跑在真浏览器里的那一层）。
//
// `useVirtualList` 有一整条 jsdom **根本无法覆盖**的路径：真实布局。jsdom 里
// `offsetHeight`/`clientHeight` 恒为 0 ⇒ 单测里每一行都是估计值，`ResizeObserver` 更是不存在。
// 于是"量出来的行高会不会真的改变窗口""折叠块展开后会不会重新量""会不会把自己变成渲染死循环"
// 这三件事，在单测里全是空跑。这里用一个最小 harness 把它们放进真浏览器。
//
// 它不进 `check:stories`（那条门禁只走 src/views），也不是给设计看的——是给这条路径当看守的。
import { useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import { useVirtualList } from '@/hooks/useVirtualList';

const TOTAL_ROWS = 5000;
const ROW_PX = 24;
const TALL_ROW_PX = 600;

function VirtualListHarness() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const keys = useMemo(() => Array.from({ length: TOTAL_ROWS }, (_, i) => `k${String(i)}`), []);
  // pinToEnd 固定为 true：这是生产上的常态（跟随底部），窗口锚在末尾。
  const { range, onScroll } = useVirtualList({ keys, scrollRef, pinToEnd: true });

  const renders = useRef(0);
  renders.current += 1;

  return (
    <div className="flex flex-col gap-2 p-2 font-mono text-xs">
      <button
        type="button"
        data-testid="grow-last"
        onClick={() => {
          setTall((v) => !v);
        }}
      >
        把最后一行撑高（模拟展开一个工具折叠块）
      </button>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-testid="host"
        data-renders={renders.current}
        style={{ height: 300, overflow: 'auto', border: '1px solid #666' }}
      >
        <ul aria-label="harness" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {range.topPx > 0 && <li aria-hidden="true" style={{ height: range.topPx }} />}
          {keys.slice(range.start, range.end).map((key, i) => {
            const isLast = range.start + i === TOTAL_ROWS - 1;
            return (
              <li
                key={key}
                data-vrow={key}
                style={{ height: tall && isLast ? TALL_ROW_PX : ROW_PX }}
              >
                {key}
              </li>
            );
          })}
          {range.bottomPx > 0 && <li aria-hidden="true" style={{ height: range.bottomPx }} />}
        </ul>
      </div>
    </div>
  );
}

const meta: Meta<typeof VirtualListHarness> = {
  title: 'Internals/useVirtualList',
  component: VirtualListHarness,
};
export default meta;

type Story = StoryObj<typeof VirtualListHarness>;

/**
 * 真浏览器里的三条断言：窗口确实很小、省下的高度确实还回了滚动容器、
 * 以及"量到更高的行 ⇒ 同样的像素预算装得下更少的行"（这一条只有真实布局能证）。
 */
export const RealLayout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const host = canvas.getByTestId('host');

    const rows = (): HTMLElement[] =>
      Array.from(host.querySelectorAll<HTMLElement>('li[data-vrow]'));

    // ① 5000 条只渲染一屏 + overscan 的量级（没有窗口化时这里就是 5000）。
    await waitFor(async () => {
      await expect(rows().length).toBeGreaterThan(0);
    });
    const initialRows = rows().length;
    await expect(initialRows).toBeLessThan(120);

    // ② 省掉的高度还回去了：scrollHeight 远大于窗口内那几十行的合计高度。
    await expect(host.scrollHeight).toBeGreaterThan(TOTAL_ROWS * 15);
    await expect(host.scrollHeight).toBeGreaterThan(initialRows * ROW_PX * 10);

    // ③ 行高是**量出来的**：把最后一行撑到 600px，同样的像素预算就装不下那么多行了。
    //    这条同时证明了 ResizeObserver 那条路——展开态住在组件自己的 state 里，
    //    窗口重算不是靠"谁重渲了"，而是靠观察内容尺寸。
    canvas.getByTestId('grow-last').click();
    await waitFor(async () => {
      await expect(rows().length).toBeLessThan(initialRows);
    });

    // ④ 没有把自己变成渲染死循环（量→setState→重算→再量 必须收敛）。
    await waitFor(async () => {
      await expect(Number(host.dataset['renders'] ?? '0')).toBeLessThan(30);
    });
  },
};
