// 搜索框防抖（P21-1 §6：「客户端实时过滤（防抖 200ms；名称/runtime）」）。
//
// ⚠️ 此前判断过"单用户任务量两位数以内用不上防抖"没做（F21-1 §9.1 #15 记录的偏离），
// 用户已裁决要与产品文档口径对齐，这一轮补上。
//
// 通用 hook，纯计时器逻辑，不含过滤/搜索本身的业务规则——过滤规则仍然全部在
// `filterTaskTree.ts`。容器把"打字瞬间的值"（`searchQuery`，喂给受控输入，敲什么就
// 立刻回显什么）与"用于真过滤的值"（这里派生出的防抖值）分成两根线：
// ⛔ 不能让输入框本身也等 200ms 才回显用户刚敲的字符，那是另一种更糟的卡顿观感。
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    // 下一次 value/delayMs 变化（或组件卸载）前先清掉上一个计时器——这正是"防抖"
    // 而不是"节流"的关键：连续多次变化只有最后一次会在 delayMs 之后真正生效。
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
