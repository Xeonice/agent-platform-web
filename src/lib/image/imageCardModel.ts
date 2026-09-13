// ImageDto → 镜像卡片视图模型派生（F21-4 §5.1，P21-4 §3/§5）。零副作用、零网络、可单测。
//
// 为什么必须在这里算干净：`ImageCard.view` 被 boundaries 禁止 import `lib/`，
// 还被 `no-restricted-syntax` 禁掉了 `useEffect`/`useLayoutEffect`——
// 所以 digest 怎么截、时间怎么说、[检查更新] 能不能点，**view 一律不算**，只吃结果（F21-4 §3.1 规则 2）。
//
// ⚠️ 本文件刻意**不产出**任何「结论过期」结论。见 `types/image.ts` 上 `ImageCardModel` 的注释与
// `__tests__/imageCardModel.test.ts` 里的否定断言。

import { formatRelativePast } from '@/lib/_shared/formatTime';
import type {
  ImageCardInput,
  ImageCardModel,
  ImageDigestState,
  ImageLineageModel,
  ImageRefInput,
  ImageRefKind,
} from '@/types/image';

/**
 * 后端今天唯一在写的 digest 值——一个**硬编码哨兵**
 * （`api/.../provision-sandbox.workflow.ts`：`digest: 'sha256:unresolved'`，P21-4 §0）。
 * 它既不是"没有 digest"也不是"已经钉死了"，所以前端必须把它单独认出来（F21-4 §5.1）。
 */
export const UNRESOLVED_DIGEST_SENTINEL = 'sha256:unresolved';

/** 截断展示：保留前 12 个字符 + 尾 3 个字符（F21-4 §7.1 ①）。 */
const DIGEST_HEAD = 12;
const DIGEST_TAIL = 3;

/** [检查更新] 置灰理由——**置灰并说明，不隐藏**（F21-4 §5.1）。 */
export const CHECK_UPDATE_DISABLED_DIGEST_REF =
  '这张镜像是直接按版本注册的（没有 tag），所以不会有新版本';
export const CHECK_UPDATE_DISABLED_UNRESOLVED = '这张镜像还没有确定版本，没有可比对的基准';

/** digest 是否为空 / 哨兵值 ⇒ 「未解析」（不留白、不显示假哈希，F21-4 §5.1）。 */
export function digestStateOf(digest: string | undefined): ImageDigestState {
  if (digest === undefined || digest === '') return 'unresolved';
  return digest === UNRESOLVED_DIGEST_SENTINEL ? 'unresolved' : 'pinned';
}

/**
 * 全串 71 字符会把卡片撑爆；截断是 OCI 生态惯例，够定位、够对账（F21-4 §5.1）。
 * 串本身短于 `前 12 + 尾 3` 时原样返回，不制造 `sha256:4b17…4b17` 这种自我重叠的假象。
 */
export function shortenDigest(digest: string): string {
  if (digest.length <= DIGEST_HEAD + DIGEST_TAIL) return digest;
  return `${digest.slice(0, DIGEST_HEAD)}…${digest.slice(-DIGEST_TAIL)}`;
}

/** 有 tag 才是 tag 形态；`repo@sha256:…`（无 tag）是 digest 形态，天然不漂移。 */
export function refKindOf(ref: ImageRefInput): ImageRefKind {
  return ref.tag === undefined || ref.tag === '' ? 'digest' : 'tag';
}

/** `docker.io/myrepo/ml-agent:v1.0`｜`docker.io/myrepo/ml-agent@sha256:…`。 */
function buildRefDisplay(ref: ImageRefInput, kind: ImageRefKind, digestState: ImageDigestState) {
  const base = [ref.registry, ref.repository].filter((part) => part !== '').join('/');
  if (kind === 'tag') return `${base}:${ref.tag ?? ''}`;
  // digest 形态但 digest 未解析：**不为它编一个 tag 显示**（P21-4 §5 ★「不要给它编一个 tag」），
  // 也不把哨兵串拼进去——只给坐标本体。
  return digestState === 'pinned' ? `${base}@${ref.digest ?? ''}` : base;
}

/**
 * 相对过去时间——**实现已提到 `lib/_shared/formatTime`**（F21-8 的向导要说同一句话）。
 * 这里保留 re-export：本文件既有的调用点与测试不必跟着搬。
 */
export { formatRelativePast };

/**
 * 「**解析于** 3 天前」。
 * ⚠️ 措辞是裁决的一部分（P21-4 §3）：原稿的「最后验证」暗示结论会随时间烂掉；钉定 digest 之后
 * 结论描述的是一个不可变对象，**不会烂**。前端不许改回「最后验证」，也不许再给它加「已过期」的黄字。
 */
export function formatResolvedAt(iso: string | undefined, now: number): string | undefined {
  const relative = formatRelativePast(iso, now);
  return relative === undefined ? undefined : `解析于 ${relative}`;
}

/**
 * 「来源」那一行 —— 后端 `derivedFromDigest` 的**如实**呈现（04 §7 ★血统，注册期算好落库）。
 *
 * ⚠️ **这个字段一直在 DTO 里，却一处都没有渲染。** 代价很具体：用户在镜像页拿到 ✅、
 * 到建任务时才撞上 `IMAGE_PROVIDER_MISMATCH` —— 而「注册期就把这件事判掉」这套设计
 * 存在的全部意义，就是不让这一幕发生。答案在手上，就得说出来。
 *
 * ⚠️ **三档，⛔ 不许压成两档：**
 *  · `anchor` —— 预置镜像**本身就是**来源起点，它没有更早的祖先。`derivedFromDigest`
 *    在它身上是 `null`，而那是**事实**（后端注释：「A ROOT'S LINEAGE IS `null`, AND THAT
 *    IS THE FACT, NOT A MISSING VALUE」）。
 *  · `derived` —— 记下了它从哪一张锚点改来。
 *  · `unknown` —— 一张自定义镜像上的 `null`：平台**没记下**它的来源。这与"没有来源"
 *    不是一回事（「不知道」不能说成「没有」），所以它要自带一句说明。
 *
 * ⛔ **这里不算兼容性。** 「这张镜像能不能跑在当前这台机器的沙箱环境上」取决于锚点属于
 * 哪一档，而那是平台自己的配置（`image-facade.port.ts` 写着这条），不是一个 digest 能推出
 * 来的。前端在这里替用户下一个"应该能用/不能用"的结论，就是造一个第二判据。
 */
export function imageLineage(input: {
  isBuiltin: boolean;
  derivedFromDigest?: string | null;
}): ImageLineageModel {
  if (input.isBuiltin) {
    return { kind: 'anchor', text: '来源：这就是平台的预制镜像（其他镜像从它改起）' };
  }
  const from = input.derivedFromDigest;
  if (from === undefined || from === null || from === '') {
    return {
      kind: 'unknown',
      text: '来源未确定',
      note: '平台没有记下这张镜像是从哪一张预制镜像改来的。这不等于它没有来源，只是这一行没有这个记录（来源是注册那一刻判定并写下的）。',
    };
  }
  return { kind: 'derived', text: `来源：从预制镜像 ${shortenDigest(from)} 改来的` };
}

/** 派生镜像卡片视图模型。`now` 显式可注入，便于单测钉死相对时间。 */
export function imageCardModel(input: ImageCardInput, now: number = Date.now()): ImageCardModel {
  const refKind = refKindOf(input.ref);
  const digestState = digestStateOf(input.ref.digest);
  const pinned = digestState === 'pinned' ? input.ref.digest : undefined;
  const resolvedAtLabel = formatResolvedAt(input.lastValidatedAt, now);

  // 两种置灰理由都成立时（以 digest 注册 + 未解析），先说「没有基准」——
  // 它是更硬的那条：连比对对象都没有。
  let checkUpdateDisabledReason: string | undefined;
  if (digestState === 'unresolved') checkUpdateDisabledReason = CHECK_UPDATE_DISABLED_UNRESOLVED;
  else if (refKind === 'digest') checkUpdateDisabledReason = CHECK_UPDATE_DISABLED_DIGEST_REF;

  return {
    id: input.id,
    name: input.name,
    refDisplay: buildRefDisplay(input.ref, refKind, digestState),
    refKind,
    digestState,
    // 未解析 ⇒ 两个字段都缺席：不产出假哈希、不产出空串，**也不把哨兵串漏进模型**。
    ...(pinned === undefined ? {} : { digestShort: shortenDigest(pinned), digestFull: pinned }),
    // 缺席 ⇒ 字段不存在，view 据此整行不渲染（而不是渲染「解析于 NaN 前」）。
    ...(resolvedAtLabel === undefined ? {} : { resolvedAtLabel }),
    // ⚠️ **恒存在**：缺席那一行读起来就是"这张镜像没有来源"，而三档里有一档恰恰是"不知道"。
    lineage: imageLineage(input),
    validationStatus: input.validationStatus,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
    supportedRuntimes: input.supportedRuntimes,
    isActive: input.isActive,
    canDelete: !input.isBuiltin,
    canCheckUpdate: refKind === 'tag' && digestState === 'pinned',
    ...(checkUpdateDisabledReason === undefined ? {} : { checkUpdateDisabledReason }),
  };
}
