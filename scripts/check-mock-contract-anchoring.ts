// CI 硬门禁（29 §3.2 第三条）：**替身响应必须锚在契约类型上**。
//
// 守的是什么：`src/mocks/handlers.ts` 的 `HttpResponse.json(...)` 与 `e2e/**/*.ts` 的
// `route.fulfill({ json: ... })`，其响应体必须能顺着 AST 追到一个**具名契约类型**上。
// 裸字面量（`json: { id: 'x', status: 'running' }`）在编译期没有任何东西盯着它：
// 后端给 DTO 加一个必填字段、改一个枚举取值，替身会**静默**保持旧形状，
// 单测 / Storybook / Playwright 照常全绿——29 §1.2 那三次事故都是这么来的。
//
// ⚠️ 这个脚本**不用正则**。正则在这个问题上做不对：`(saved ? [A] : []) satisfies T[]`
// 的嵌套括号、`json: [PROJECT]` 的数组包装、`satisfies` 落在截断窗口之外的长对象……
// 人工用正则扫过两轮，误报率 10–20%。这里走 TypeScript AST。
//
// ── 判据：下列任一成立即算「已锚定」────────────────────────────────────────
//   ① `satisfies T`（`X satisfies ProjectDto[]`）；
//   ② `as T`（T 不是 `const`/`any`/`unknown`）——同样是显式契约标注；
//   ③ 具名常量/变量，且该声明自己已锚定（有 `: T` 类型标注，或初始值已锚定），
//      跨文件 import 会继续追（`@/…` 与相对路径都解析）；
//   ④ 有显式返回类型的 helper 调用（`projectDto({...})` / `respond(query)`）；
//   ⑤ 数组字面量，且**每个元素**都已锚定（`[PROJECT]`、`[...ROWS]`）；
//   ⑥ 三元 / `??` / `||` —— 每个分支都已锚定；
//   ⑦ 保型数组方法链（`.filter/.slice/.concat/.sort/.toSorted/.reverse/.toReversed/.at`），
//      且接收者已锚定（`.map` **不算**：它换元素类型，必须自己 `satisfies`）；
//   ⑧ 明确豁免：在该值所在行（或上一行）写 `contract-exempt: <理由>` 注释。
//      理由是必填的、会被脚本读出来打进报告——⛔ 不接受"一张不说明为什么的白名单"。
//
// 反过来说，**裸对象字面量 / 裸字符串 / 裸数字 / 空数组 `[]` 一律红**：
// 它们必须写成 `{...} satisfies XxxDto` 或 `[] satisfies XxxDto[]`。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 保型的数组方法：结果的元素类型与接收者一致，接收者锚定即可传递。 */
const TYPE_PRESERVING_ARRAY_METHODS = new Set([
  'filter',
  'slice',
  'concat',
  'sort',
  'toSorted',
  'reverse',
  'toReversed',
  'at',
]);

/** 这些「类型标注」等于没标注，不算锚定。 */
const NON_ANCHORING_TYPE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AnyKeyword,
  ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.ObjectKeyword,
]);

const EXEMPT_MARKER = /contract-exempt:\s*(\S.*?)\s*(?:\*\/)?\s*$/;

// ————————————————————————————————————————————————————————————————
// 源文件缓存 + 模块解析（跨文件追 import）
// ————————————————————————————————————————————————————————————————
const sourceCache = new Map<string, ts.SourceFile>();

function parse(file: string): ts.SourceFile {
  const cached = sourceCache.get(file);
  if (cached !== undefined) return cached;
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  sourceCache.set(file, sf);
  return sf;
}

/** `@/x` → `src/x`；`./x` → 相对；裸包名 → 解析不了（外部依赖，返回 undefined）。 */
function resolveModule(specifier: string, fromFile: string): string | undefined {
  let base: string;
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolvePath(dirname(fromFile), specifier);
  else return undefined;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined;
}

// ————————————————————————————————————————————————————————————————
// 作用域内的标识符解析
// ————————————————————————————————————————————————————————————————
type Decl =
  | { kind: 'variable'; node: ts.VariableDeclaration; file: string }
  | { kind: 'function'; node: ts.FunctionDeclaration; file: string }
  | { kind: 'parameter'; node: ts.ParameterDeclaration; file: string }
  | { kind: 'import'; node: ts.ImportSpecifier | ts.ImportClause; file: string };

function bindingMatches(name: ts.BindingName, target: string): boolean {
  return ts.isIdentifier(name) && name.text === target;
}

/** 在一组语句里找同名声明（不下钻嵌套函数体，那是别的作用域）。 */
function findInStatements(
  statements: readonly ts.Statement[],
  name: string,
  file: string,
): Decl | undefined {
  for (const st of statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (bindingMatches(d.name, name)) return { kind: 'variable', node: d, file };
      }
    } else if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
      return { kind: 'function', node: st, file };
    } else if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      if (clause === undefined) continue;
      if (clause.name?.text === name) return { kind: 'import', node: clause, file };
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const spec of named.elements) {
          if (spec.name.text === name) return { kind: 'import', node: spec, file };
        }
      }
    }
  }
  return undefined;
}

/** 从引用点沿父链向上，逐层作用域查找。 */
function resolveIdentifier(id: ts.Identifier, file: string): Decl | undefined {
  const name = id.text;
  let node: ts.Node = id;
  for (;;) {
    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      const hit = findInStatements(node.statements, name, file);
      if (hit !== undefined) return hit;
    }
    // 函数参数
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      for (const p of node.parameters) {
        if (bindingMatches(p.name, name)) return { kind: 'parameter', node: p, file };
      }
    }
    if (ts.isSourceFile(node)) return undefined; // 到顶了，这个名字不是本仓声明的
    node = node.parent;
  }
}

/** import 说明符 → 目标文件里的导出声明。 */
function followImport(decl: Extract<Decl, { kind: 'import' }>): Decl | undefined {
  const importDecl = ts.isImportSpecifier(decl.node)
    ? decl.node.parent.parent.parent
    : decl.node.parent;
  if (!ts.isImportDeclaration(importDecl)) return undefined;
  const spec = importDecl.moduleSpecifier;
  if (!ts.isStringLiteral(spec)) return undefined;
  const target = resolveModule(spec.text, decl.file);
  if (target === undefined) return undefined;

  // 追的是「原名」：`import { A as B }` 要在目标文件里找 A。
  const exportedName = ts.isImportSpecifier(decl.node)
    ? (decl.node.propertyName?.text ?? decl.node.name.text)
    : 'default';
  return findInStatements(parse(target).statements, exportedName, target);
}

// ————————————————————————————————————————————————————————————————
// 「是不是契约类型标注」
// ————————————————————————————————————————————————————————————————
function isAnchoringType(type: ts.TypeNode | undefined): boolean {
  if (type === undefined) return false;
  if (NON_ANCHORING_TYPE_KINDS.has(type.kind)) return false;
  // `as const` 只是收窄字面量，不引入契约类型。
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'const'
  )
    return false;
  if (ts.isArrayTypeNode(type)) return isAnchoringType(type.elementType);
  if (ts.isTypeOperatorNode(type)) return isAnchoringType(type.type); // readonly T[]
  if (ts.isParenthesizedTypeNode(type)) return isAnchoringType(type.type);
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type))
    return type.types.every((t) => isAnchoringType(t));
  // TypeReference / IndexedAccess（`operations[...][200]`）/ TypeLiteral 皆算显式标注。
  return true;
}

// ————————————————————————————————————————————————————————————————
// 核心判定
// ————————————————————————————————————————————————————————————————
interface Verdict {
  anchored: boolean;
  why: string;
}

const OK = (why: string): Verdict => ({ anchored: true, why });
const NO = (why: string): Verdict => ({ anchored: false, why });

function judgeDecl(decl: Decl, seen: Set<ts.Node>): Verdict {
  if (seen.has(decl.node)) return NO('循环引用');
  seen.add(decl.node);

  switch (decl.kind) {
    case 'variable': {
      if (isAnchoringType(decl.node.type))
        return OK(`常量有类型标注 : ${decl.node.type!.getText()}`);
      if (decl.node.initializer === undefined) return NO('常量既无类型标注也无初始值');
      const inner = judge(decl.node.initializer, decl.file, seen);
      return inner.anchored
        ? OK(`常量初始值已锚定（${inner.why}）`)
        : NO(`常量未锚定（${inner.why}）`);
    }
    case 'function':
      return isAnchoringType(decl.node.type)
        ? OK(`helper 有显式返回类型 : ${decl.node.type!.getText()}`)
        : NO('helper 缺显式返回类型');
    case 'parameter':
      return isAnchoringType(decl.node.type)
        ? OK(`形参有类型标注 : ${decl.node.type!.getText()}`)
        : NO('形参缺类型标注');
    case 'import': {
      const followed = followImport(decl);
      if (followed === undefined) return NO('import 来源解析不到');
      return judgeDecl(followed, seen);
    }
  }
}

/** `(q: URLSearchParams) => AuditListDto` 这种函数类型标注 → 取它的返回类型。 */
function returnTypeOfAnnotation(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (type === undefined) return undefined;
  if (ts.isParenthesizedTypeNode(type)) return returnTypeOfAnnotation(type.type);
  return ts.isFunctionTypeNode(type) ? type.type : undefined;
}

/**
 * helper 调用是否锚定。三种形态都认：
 *   `function f(): T {}` / `const f = (x): T => …` / 形参 `respond: (q) => T`
 * （最后一种是 e2e 里的常见写法：把「回什么」作为参数传进 route 装配函数。）
 */
function judgeCallee(callee: ts.Expression, file: string): Verdict {
  if (!ts.isIdentifier(callee)) return NO('调用目标不是具名 helper');
  let decl = resolveIdentifier(callee, file);
  if (decl?.kind === 'import') decl = followImport(decl);
  if (decl === undefined) return NO(`解析不到 helper \`${callee.text}\``);

  if (decl.kind === 'function')
    return isAnchoringType(decl.node.type)
      ? OK(`helper \`${callee.text}\` 返回类型 : ${decl.node.type!.getText()}`)
      : NO(`helper \`${callee.text}\` 缺显式返回类型`);

  if (decl.kind === 'variable' || decl.kind === 'parameter') {
    const ret = returnTypeOfAnnotation(decl.node.type);
    if (ret !== undefined)
      return isAnchoringType(ret)
        ? OK(`helper \`${callee.text}\` 返回类型 : ${ret.getText()}`)
        : NO(`helper \`${callee.text}\` 的返回类型不是契约类型`);
    if (isAnchoringType(decl.node.type)) return OK(`helper \`${callee.text}\` 有类型标注`);
    const init = decl.kind === 'variable' ? decl.node.initializer : decl.node.initializer;
    if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      return isAnchoringType(init.type)
        ? OK(`helper \`${callee.text}\` 返回类型 : ${init.type!.getText()}`)
        : NO(`helper \`${callee.text}\` 缺显式返回类型`);
    }
  }
  return NO(`\`${callee.text}\` 不是有显式返回类型的 helper`);
}

/** `.map(cb)` 换元素类型 ⇒ 看回调体本身锚没锚（`(r) => ({…}) satisfies Dto`）。 */
function judgeMapCallback(
  arg: ts.Expression | undefined,
  file: string,
  seen: Set<ts.Node>,
): Verdict {
  if (arg === undefined) return NO('.map() 无回调');
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    if (isAnchoringType(arg.type)) return OK(`.map() 回调返回类型 : ${arg.type!.getText()}`);
    if (!ts.isBlock(arg.body)) return judge(arg.body, file, seen);
    // 块体：所有 return 表达式都要锚定
    const returns: ts.Expression[] = [];
    const collect = (n: ts.Node): void => {
      if (ts.isFunctionLike(n) && n !== arg) return; // 嵌套函数不算
      if (ts.isReturnStatement(n) && n.expression !== undefined) returns.push(n.expression);
      ts.forEachChild(n, collect);
    };
    collect(arg.body);
    if (returns.length === 0) return NO('.map() 回调没有 return');
    for (const r of returns) {
      const v = judge(r, file, seen);
      if (!v.anchored) return NO(`.map() 回调 return：${v.why}`);
    }
    return OK('.map() 回调每个 return 均已锚定');
  }
  return judgeCallee(arg, file);
}

function judge(expr: ts.Expression, file: string, seen = new Set<ts.Node>()): Verdict {
  // 透明包装：() / ! / await
  if (ts.isParenthesizedExpression(expr)) return judge(expr.expression, file, seen);
  if (ts.isNonNullExpression(expr)) return judge(expr.expression, file, seen);
  if (ts.isAwaitExpression(expr)) return judge(expr.expression, file, seen);

  // ① satisfies（`satisfies any` / `satisfies unknown` 不算——那是把门拆了）
  if (ts.isSatisfiesExpression(expr))
    return isAnchoringType(expr.type)
      ? OK(`satisfies ${expr.type.getText()}`)
      : NO(`satisfies ${expr.type.getText()} 不是契约类型`);

  // ② as T（`as const` 透明穿过，不构成锚定）
  if (ts.isAsExpression(expr)) {
    if (isAnchoringType(expr.type)) return OK(`as ${expr.type.getText()}`);
    return judge(expr.expression, file, seen);
  }

  // ⑥ 三元 / ?? / ||
  if (ts.isConditionalExpression(expr)) {
    const a = judge(expr.whenTrue, file, seen);
    if (!a.anchored) return NO(`三元 then 分支：${a.why}`);
    const b = judge(expr.whenFalse, file, seen);
    if (!b.anchored) return NO(`三元 else 分支：${b.why}`);
    return OK('三元两支均已锚定');
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const a = judge(expr.left, file, seen);
    if (!a.anchored) return NO(`左支：${a.why}`);
    const b = judge(expr.right, file, seen);
    if (!b.anchored) return NO(`右支：${b.why}`);
    return OK('两支均已锚定');
  }

  // ⑤ 数组字面量：空数组必须自己 satisfies；非空则每个元素都要锚定
  if (ts.isArrayLiteralExpression(expr)) {
    if (expr.elements.length === 0) return NO('空数组字面量（写成 `[] satisfies XxxDto[]`）');
    for (const [i, el] of expr.elements.entries()) {
      const target = ts.isSpreadElement(el) ? el.expression : el;
      const v = judge(target, file, seen);
      if (!v.anchored) return NO(`数组第 ${String(i)} 项：${v.why}`);
    }
    return OK('数组每一项均已锚定');
  }

  // ④/⑦ 调用
  if (ts.isCallExpression(expr)) {
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const method = expr.expression.name.text;
      if (TYPE_PRESERVING_ARRAY_METHODS.has(method)) {
        const recv = judge(expr.expression.expression, file, seen);
        return recv.anchored
          ? OK(`保型数组方法 .${method}()（接收者：${recv.why}）`)
          : NO(`.${method}() 的接收者未锚定：${recv.why}`);
      }
      if (method === 'map' || method === 'flatMap')
        return judgeMapCallback(expr.arguments[0], file, seen);
      return NO(`方法调用 .${method}() 不保型（请对结果写 satisfies）`);
    }
    return judgeCallee(expr.expression, file);
  }

  // ③ 具名标识符
  if (ts.isIdentifier(expr)) {
    const decl = resolveIdentifier(expr, file);
    if (decl === undefined) return NO(`解析不到标识符 \`${expr.text}\``);
    const v = judgeDecl(decl, seen);
    return v.anchored ? OK(`\`${expr.text}\`：${v.why}`) : NO(`\`${expr.text}\`：${v.why}`);
  }

  // 其余：裸对象/字符串/数字/属性访问…… 一律未锚定
  if (ts.isObjectLiteralExpression(expr)) return NO('裸对象字面量（缺 satisfies）');
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr))
    return NO('属性访问结果未标注（请写 satisfies）');
  return NO(`裸字面量 / 未识别表达式（${ts.SyntaxKind[expr.kind]}）`);
}

// ————————————————————————————————————————————————————————————————
// 豁免：该值所在行或上一行的 `contract-exempt: <理由>` 注释
// ————————————————————————————————————————————————————————————————
function findExemption(sf: ts.SourceFile, node: ts.Node): string | undefined {
  const text = sf.getFullText();
  const lines = text.split('\n');
  const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const candidates: string[] = [];
  // 同行：行尾注释（`json: X, // contract-exempt: …`）
  candidates.push(lines[startLine] ?? '');
  // 上一行：**必须是整行注释**。否则上一行的行尾豁免会顺手把下一行也放过去
  //（自检时真踩到了：`// contract-exempt: xy` 太短被拒后，静默捡了上一行的理由）。
  const prev = (lines[startLine - 1] ?? '').trim();
  if (prev.startsWith('//') || prev.startsWith('*') || prev.startsWith('/*')) candidates.push(prev);

  for (const line of candidates) {
    const m = EXEMPT_MARKER.exec(line);
    if (m?.[1] !== undefined && m[1].length >= 4) return m[1];
  }
  return undefined;
}

// ————————————————————————————————————————————————————————————————
// 采集检查点
// ————————————————————————————————————————————————————————————————
interface Site {
  file: string;
  line: number;
  label: string;
  expr: ts.Expression;
  node: ts.Node;
}

function collectSites(sf: ts.SourceFile): Site[] {
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    // MSW：HttpResponse.json(<body>, ...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'HttpResponse'
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined) {
        sites.push({
          file: sf.fileName,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          label: 'HttpResponse.json(…)',
          expr: arg,
          node,
        });
      }
    }
    // Playwright：route.fulfill({ json: <body> })
    if (ts.isPropertyAssignment(node) && !ts.isComputedPropertyName(node.name)) {
      const key = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      if (key === 'json') {
        sites.push({
          file: sf.fileName,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          label: 'route.fulfill({ json })',
          expr: node.initializer,
          node,
        });
      }
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'json') {
      sites.push({
        file: sf.fileName,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        label: 'route.fulfill({ json })',
        expr: node.name,
        node,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// ————————————————————————————————————————————————————————————————
// main
// ————————————————————————————————————————————————————————————————
const VERBOSE = process.argv.includes('--verbose');
const targets: string[] = [];
const mocksDir = join(ROOT, 'src', 'mocks');
if (existsSync(mocksDir)) targets.push(...walk(mocksDir).filter((f) => !f.endsWith('.test.ts')));
const e2eDir = join(ROOT, 'e2e');
if (existsSync(e2eDir)) targets.push(...walk(e2eDir));

const violations: string[] = [];
const exemptions: string[] = [];
let checked = 0;

for (const file of targets.sort()) {
  const sf = parse(file);
  for (const site of collectSites(sf)) {
    checked += 1;
    const rel = file.replace(`${ROOT}/`, '');
    const verdict = judge(site.expr, file);
    if (verdict.anchored) {
      // `--verbose`：把每一处的**锚定理由**打出来，方便人工复核门禁没有放水。
      if (VERBOSE) console.log(`   ✓ ${rel}:${String(site.line)} — ${verdict.why}`);
      continue;
    }
    const reason = findExemption(sf, site.node);
    if (reason !== undefined) {
      exemptions.push(`${rel}:${String(site.line)} — ${reason}`);
      continue;
    }
    const snippet = site.expr.getText(sf).replace(/\s+/g, ' ').slice(0, 90);
    violations.push(
      `   - ${rel}:${String(site.line)}  ${site.label}\n     值：${snippet}\n     原因：${verdict.why}`,
    );
  }
}

if (exemptions.length > 0) {
  console.log('ℹ️  显式豁免（每条都带理由，见源码行内 `contract-exempt:` 注释）：');
  for (const e of exemptions) console.log(`   - ${e}`);
}

if (violations.length > 0) {
  console.error(
    '❌ 以下替身响应没有锚在契约类型上（29 §3.2：替身的形状可以手写，替身的值不能凭空）：',
  );
  for (const v of violations) console.error(v);
  console.error(
    '\n修法：给值加 `satisfies XxxDto`；或抽成有 `: XxxDto` 标注的常量 / 有显式返回类型的 helper；\n' +
      '确实不该锚定的（空体、字节流、非契约形状）在同行或上一行写 `// contract-exempt: <理由>`。',
  );
  process.exit(1);
}

console.log(
  `✅ 替身契约锚定检查通过：${String(checked)} 处响应体全部锚定（豁免 ${String(exemptions.length)} 处）。`,
);
