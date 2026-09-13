// CI 硬门禁：**渲染给用户的文本里不许出现 emoji**，图标一律走 lucide（shadcn 的内置图标库，
// `components.json` 里 `"iconLibrary": "lucide"`）。
//
// ── 这个门禁为什么存在 ──────────────────────────────────────────────────────────
// 2026-09-13 全仓扫出 **37 个文件、约 85 处**渲染文本仍在用 emoji 当图标。它们不是一次
// 写坏的，是**一次一个功能慢慢攒出来的** —— 每次只多一两处，每次都"不值得单独提一嘴"。
// 清完之后如果没有门禁，下一个功能会原样再攒一遍。⇒ 这条规则必须由机器守，不能靠自觉。
//
// ── 为什么不许 ────────────────────────────────────────────────────────────────
// ① **emoji 的渲染由字体决定**：同一个码位在不同系统/浏览器下字形、尺寸、基线都不同，
//    没法与周围文字对齐，也吃不到设计 token 的颜色（`success`/`warning`/`error` 那套）。
// ② **它把表现层焊进了数据**：`title: '❌ 装不上'` 这种写法让 `lib/` 纯逻辑层拿着一个
//    表现细节，view 想换图标就得改字符串。正确形状是 lib 给**语义**（`severity: 'fail'`）、
//    view 渲染图标 —— `StatusPill` 就是这个先例。
// ③ **可访问性**：emoji 会被屏幕阅读器逐个念出来（「❌」念成「cross mark」），而 lucide
//    图标带 `aria-hidden` 时干脆不念，语义留在文字里。
//
// ── 扫描口径 ──────────────────────────────────────────────────────────────────
// ⛔ **只扫会渲染的文本，不扫注释**。注释里的 ⚠️/⛔/⭐ 是这个仓库的纪律记号法，是有意的，
//    扫它们只会逼人把注释写得更难读。
// ⚠️ 判据是"这一行在不在注释里"，用一个**跟踪块注释状态**的小状态机，不是 AST。
//    ⛔ 第一版只做逐行前缀匹配（`//` / `*` / `{/*`），**漏掉了多行注释的续行** ——
//    那种行首是正文，于是三条注释被当成违规报了出来。改成跟踪 `/* … */` 与 `{/* … */}`
//    的开闭之后才准。
// ⚠️ 仍然会漏「代码 + 行尾注释」这种同行混排里注释那半边的 emoji。这是**刻意的取舍**：
//    漏报只是少拦一次，误报（把注释里的纪律记号当违规）会让人开始删注释。宁可漏，不可误。
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/**
 * ⛔ **豁免目录**，各有各的理由：
 *   · `__tests__` / `__stories__` / `*.test.*`：断言里要写「⛔ 不许再出现 emoji」这类
 *     反向用例，本来就得把违规字符写出来。
 *   · `mocks/`：那里在模拟**后端返回的文案**。后端文案里的 emoji 是 api 侧的问题，
 *     由那边自己决定，前端门禁不该越界替它判。
 */
const EXEMPT = /(__tests__|__stories__|\.test\.[tj]sx?$|[/\\]mocks[/\\])/;

/**
 * ⛔ **不在禁令内的字符**，两类：
 *   · `⚠⛔⇒★⭐·`：注释纪律记号（虽然只扫非注释行，但字符串里偶尔也会引用它们）。
 *   · `①–⑳`：诊断项的**序号圆标**，是设计稿点名要的（原型 §system 那八项），
 *     lucide 没有等价物，且它们是**内容**不是图标。
 */
// ⚠️ U+FE0F（变体选择符）**单列**，⛔ 不能塞进上面的字符类 —— 它是组合字符，
//    放进 `[...]` 会被 `no-misleading-character-class` 拦（语义上它也不是「一个字符」）。
const ALLOWED = /[⚠⛔⇒★⭐·①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\uFE0F/u;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(SRC)) {
  console.log('check-no-emoji: 无 src 目录，跳过。');
  process.exit(0);
}

const hits: string[] = [];
const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !EXEMPT.test(f));

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  // ⚠️ 跨行状态：多行注释的**续行**行首是正文，逐行前缀判据够不着（见文件头）。
  let inBlock = false;
  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    const opens = line.includes('/*');
    const closes = line.includes('*/');
    const wasInBlock = inBlock;
    if (opens && !closes) inBlock = true;
    else if (closes) inBlock = false;
    if (wasInBlock || opens) return;
    if (trimmed.startsWith('//')) return;
    for (const ch of line) {
      if (ALLOWED.test(ch)) continue;
      if (EMOJI.test(ch)) {
        hits.push(`${relative(ROOT, file)}:${String(i + 1)}  ${ch}  ${trimmed.slice(0, 70)}`);
        return;
      }
    }
  });
}

if (hits.length > 0) {
  console.error(`\n⛔ 渲染文本里发现 ${String(hits.length)} 处 emoji —— 图标请用 lucide：\n`);
  for (const h of hits) console.error(`   ${h}`);
  console.error(
    '\n   改法：lib 给语义字段（如 `severity: "fail"`），view 用 lucide 图标渲染；' +
      '\n   参考 `components/ui/status-pill.tsx` 与 `components/ui/outcome-icon.tsx`。\n',
  );
  process.exit(1);
}

console.log(`✅ 无 emoji 检查通过：${String(files.length)} 个源文件的渲染文本均未使用 emoji。`);
