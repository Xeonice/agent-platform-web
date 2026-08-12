// CI 硬门禁（12 §2.5）：每个 *.view.tsx 必须有同名 *.stories.tsx，缺失即 exit 1。
// 文件存在性检查比 AST 规则更简单可靠。
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWS_DIR = join(ROOT, 'src', 'views');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(VIEWS_DIR)) {
  console.log('check-story-coverage: 无 src/views 目录，跳过。');
  process.exit(0);
}

const viewFiles = walk(VIEWS_DIR).filter((f) => f.endsWith('.view.tsx'));
const missing: string[] = [];

for (const view of viewFiles) {
  const dir = dirname(view);
  const base = basename(view, '.view.tsx');
  const story = join(dir, `${base}.view.stories.tsx`);
  if (!existsSync(story)) missing.push(view);
}

if (missing.length > 0) {
  console.error('❌ 以下 view 缺少配套 story（12 §2.5 每个 view 必须有 story）：');
  for (const m of missing) console.error('   - ' + m.replace(ROOT + '/', ''));
  process.exit(1);
}

console.log(`✅ story 覆盖检查通过：${String(viewFiles.length)} 个 view 均有配套 story。`);
