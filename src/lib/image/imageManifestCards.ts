// `ImageManifestDto[]`（wire）→ 卡片入参 + 版本历史（F21-4 §5.1/§6，P21-4 §5 ★）。
// 零副作用、零网络、可单测。lib 只依赖 lib/type（07 §4.1），wire 形状取生成物别名。
//
// 为什么需要这一层，而 `imageCardModel.ts` 不能直接吃 DTO：**DTO 与卡片入参不同形**。
//  · DTO 的 `ref` 是**一整个字符串**（`ghcr.io/a/b:v1` / `ghcr.io/a/b@sha256:…`），
//    而 `ImageCardInput.ref` 是拆开的坐标——拆这一步有一个真的会咬人的细节（见 `parseManifestRef`）；
//  · DTO 的 `validationErrors` **不只装 errors**：后端 `storedFindings()` 在 `warning` 档
//    放的是 **warnings**（字段名是历史包袱）。照字面把它当 errors 渲染，⚠️ 档的后果说明
//    就会以红色 errors 的形态出现在一张"可正常使用"的卡上；
//  · **一张卡 = 同一个 `imageId` 的多行**（P21-4 §5 ★：更新 = INSERT 新行 + 旧行下线），
//    列表是逐行返回的，聚合只能在这里做。
import { shortenDigest } from '@/lib/image/imageCardModel';
import type {
  EnvVarRowModel,
  ImageCardInput,
  ImageConfigDto,
  ImageManifestDto,
  ImageValidationStatus,
  ImageVersionRowModel,
} from '@/types/image';

/** `name[:tag]` / `name@sha256:…` 拆开后的形状（与后端 `parseImageRef` 同口径）。 */
export interface ParsedManifestRef {
  /** tag/digest 之前的一切，**含 registry host**（`ghcr.io/a/b`）。 */
  name: string;
  /** tag 形态才有。 */
  tag?: string;
  /** digest 形态（`…@sha256:…`）才有——这种 ref 本身就是不可变坐标，天然不漂移。 */
  digest?: string;
}

/**
 * 拆 `name[:tag][@digest]`。
 *
 * ⚠️ **冒号必须从最后一个 `/` 之后开始找**（后端 `parseImageRef` 同款注释，一字不改地成立）：
 * `localhost:5001/img:v1` 的第一个冒号在 **registry host** 里，从头找会把整条坐标读成
 * name=`localhost` + tag=`5001/img:v1`——一个指向完全不同镜像的名字。本仓 boxlite e2e 依赖的
 * 本地 `:5001` 镜像源正好是这个形状，于是这个 bug 在别处都不会露头，**只在最要紧的地方错**。
 *
 * ⚠️ 没有 tag 也没有 digest 时**不补 `latest`**：后端 `formatImageRef` 保证 DTO 的 ref 一定带
 * 其中之一，所以走到这里就是异常输入；此时"编一个 tag"会让卡片显示一个用户从没填过的坐标，
 * 正是 P21-4 §5 ★ 明令禁止的那件事（「不要给它编一个 tag 显示」）。
 */
export function parseManifestRef(ref: string): ParsedManifestRef {
  const at = ref.indexOf('@');
  if (at >= 0) return { name: ref.slice(0, at), digest: ref.slice(at + 1) };
  const lastSlash = ref.lastIndexOf('/');
  const colon = ref.indexOf(':', lastSlash + 1);
  if (colon < 0) return { name: ref };
  return { name: ref.slice(0, colon), tag: ref.slice(colon + 1) };
}

/**
 * `pending` 档落到卡上时说的那句话。
 *
 * ⚠️ **`pending` 在 P21-4 §5 的状态矩阵里没有呈现，而 DTO 的枚举里有它**（列默认值，13 §2.4）。
 * 正常路径产生不出来（注册前先 validate，invalid 干脆不落库），所以它是**数据异常**，
 * 但卡片总得渲染点什么。三档里只能选一档，两档都不完全贴切，选 ❌ 的理由是本仓自己的那条
 * 纪律——**少报是降级，多报是撒谎**（10 §6.8 `sideEffectFree` 缺省读法）：
 *  · 渲成 ⚠️ 的字面意思是「验证通过但有警告」+「可正常使用」，而它**根本没有被验证过**，
 *    并且 `selectableImages` 的白名单（valid|warning）已经把它挡在向导下拉之外
 *    ——说"可正常使用"与事实相反；
 *  · 渲成 ❌ 的**后果描述是真的**（"不可用于创建"），代价只是标题偏重。
 * errors 里那句话把真相说明白，并给出唯一出路（[重新验证]）。
 */
export const PENDING_NOT_JUDGED_MESSAGE =
  '平台还没有对这张镜像出具验证结论（数据异常），因此它现在不能用于创建任务。点 [重新验证] 让平台判定一次。';

/** DTO 的四档 → 卡片的三档。`pending` 的处置见 `PENDING_NOT_JUDGED_MESSAGE`。 */
export function cardValidationStatus(
  status: ImageManifestDto['validationStatus'],
): ImageValidationStatus {
  return status === 'pending' ? 'invalid' : status;
}

/**
 * 一行 manifest → `imageCardModel()` 的入参。
 *
 * ⚠️ `registry` 恒为空串、整条坐标塞进 `repository`：DTO **没有**把 registry host 单独拆出来
 * （`images.name` 本来就含 host），而 `buildRefDisplay` 会把两段用 `/` 拼回去。
 * 猜一个 `docker.io` 填进 registry = 凭空造一段用户没填过的坐标；空串被 `filter` 掉，
 * 拼出来的 `refDisplay` 与 DTO 的 `ref` 逐字相同——这正是我们要的。
 */
export function manifestToCardInput(dto: ImageManifestDto): ImageCardInput {
  const parsed = parseManifestRef(dto.ref);
  const status = cardValidationStatus(dto.validationStatus);
  // ⚠️ `validationErrors` 装的是「当前档位的 findings」而不是「errors」：
  // 后端 `storedFindings()` 在 invalid 档给 errors、warning 档给 **warnings**、其余给 null。
  const findings = (dto.validationErrors ?? []).map((f) => f.message);
  const warnings = dto.validationStatus === 'warning' ? findings : [];
  const errors =
    dto.validationStatus === 'invalid'
      ? findings
      : dto.validationStatus === 'pending'
        ? [PENDING_NOT_JUDGED_MESSAGE]
        : [];

  return {
    id: dto.id,
    name: dto.imageName,
    ref: { registry: '', repository: parsed.name, tag: parsed.tag, digest: dto.digest },
    validationStatus: status,
    supportedRuntimes: dto.supportedRuntimes,
    isActive: dto.isActive,
    isBuiltin: dto.isBuiltin,
    // 「解析于 X 前」的时刻。后端把 `resolvedAt` 与 `registeredAt` 定义成同一个事件
    // （行是在解析出坐标的那一刻 INSERT 的，digest 此后永不 UPDATE），这里读语义对的那个。
    lastValidatedAt: dto.resolvedAt,
    warnings,
    errors,
  };
}

/** 一张卡 = 一个 `imageId`：卡面那一行 + 背后的其余行。 */
export interface ImageCardGroup {
  imageId: string;
  imageName: string;
  /** 卡面：当前活行（没有活行时退回最近注册的一行，见 `groupManifestsByImage`）。 */
  face: ImageManifestDto;
  /** 其余行，注册时间倒序。 */
  history: ImageVersionRowModel[];
}

/** ✅ > ⚠️ > ❌ 的档位次序（F21-4 §6「排序」）；`pending` 与 ❌ 同档（它已被归到 ❌ 渲染）。 */
const STATUS_RANK: Record<ImageManifestDto['validationStatus'], number> = {
  valid: 0,
  warning: 1,
  invalid: 2,
  pending: 2,
};

function toVersionRow(dto: ImageManifestDto): ImageVersionRowModel {
  const digestShort = dto.digest === '' ? undefined : shortenDigest(dto.digest);
  return {
    id: dto.id,
    version: dto.version,
    ...(digestShort === undefined ? {} : { digestShort }),
    isActive: dto.isActive,
    registeredAt: dto.registeredAt,
    validationStatus: dto.validationStatus,
  };
}

function registeredDesc(a: ImageManifestDto, b: ImageManifestDto): number {
  return b.registeredAt.localeCompare(a.registeredAt);
}

/**
 * 按 `imageId` 聚合成卡，卡面是**当前活行**，其余收进历史（P21-4 §5 ★）。
 *
 * ⚠️ **同一个 imageId 可能有不止一行是活的**：唯一索引管的是
 * `unique(image_id, version) WHERE is_active`——每个 **tag** 一行活的，而同一张镜像可以有
 * 多个 tag（`:v1` 与 `:v2` 是同一个 `imageId`）。此时卡面取**最近注册的那一行活行**，
 * 其余照样进历史列表（历史行上标着自己的 tag，且 `isActive` 为真时不给 [切换到此版本]）。
 * 这不是"把一行藏起来"：历史列表把它们全列出来了，只是卡面一次只能说一件事。
 *
 * ⚠️ **一行活的都没有时不能让整张卡消失**：全部被禁用的镜像仍然要能被看到、被 [启用]
 * （启用走 `activate`，见 service）。此时卡面退回最近注册的那一行。
 */
export function groupManifestsByImage(list: readonly ImageManifestDto[]): ImageCardGroup[] {
  const byImage = new Map<string, ImageManifestDto[]>();
  for (const dto of list) {
    const rows = byImage.get(dto.imageId);
    if (rows === undefined) byImage.set(dto.imageId, [dto]);
    else rows.push(dto);
  }

  const groups: ImageCardGroup[] = [];
  for (const [imageId, rows] of byImage) {
    const sorted = [...rows].sort(registeredDesc);
    const face = sorted.find((r) => r.isActive) ?? sorted[0];
    // Map 的每个桶至少有一行（它是被 push 出来的），`sorted[0]` 因此不可能缺席；
    // `noUncheckedIndexedAccess` 看不出这点，用显式判空而不是 `!` 断言（lint 禁 `!`）。
    if (face === undefined) continue;
    groups.push({
      imageId,
      imageName: face.imageName,
      face,
      history: sorted.filter((r) => r.id !== face.id).map(toVersionRow),
    });
  }

  return groups.sort((a, b) => {
    const rank = STATUS_RANK[a.face.validationStatus] - STATUS_RANK[b.face.validationStatus];
    return rank !== 0 ? rank : registeredDesc(a.face, b.face);
  });
}

/**
 * manifest 上的运行参数 → 编辑器行模型。
 *
 * ⚠️ **后端把已存 secret 的 value 掩码成 `''`**（I-IMG-5：密文都不回读，更别说明文），
 * 而空 value 在**入站**方向的含义是「保持不变」。两者对上了，于是 `secretStored` 就是
 * "这一行的 secret 是库里已经有的" —— 用户不动它、原样提交，就是一次无操作，而不是清空。
 */
export function envRowsFromConfig(config: ImageConfigDto | null): EnvVarRowModel[] {
  return (config?.env ?? []).map((entry, index) => ({
    // 行 id 与下标解耦：删掉第 2 行之后，第 3 行的 React key 不能跟着变成 2。
    id: `env-${String(index)}`,
    key: entry.key,
    value: entry.value,
    secret: entry.secret,
    secretStored: entry.secret,
  }));
}

/** 卡面上的环境变量摘要：`LOG_LEVEL=info · MY_SECRET=***`。secret **一律掩码，原值不进 DOM**。 */
export function envSummary(config: ImageConfigDto | null): string {
  return (config?.env ?? [])
    .map((entry) => `${entry.key}=${entry.secret ? '***' : entry.value}`)
    .join(' · ');
}
