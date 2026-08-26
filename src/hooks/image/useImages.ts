// 镜像列表 Query + 镜像管理页的全部编排（F21-4 §4/§5/§5.1）。
//
// ⚠️ **校验跑在这一层，不在 view 里**（F21-4 §3.1 规则 1）：`EnvVarEditor.view` 被 boundaries
// 禁止 import `lib/`（view 只能 import view/type/component），还被 `no-restricted-syntax`
// 禁掉了 `useEffect`。所以 `validateEnvVars()` 只能在 hook 里跑完，view 接 `errors` /
// `valueByteCounts` / `canAddRow` 三个 prop 去渲染。同理，「解析于 3 天前」「digest 怎么截」
// 「[检查更新] 能不能点」全部由 `lib/image/imageCardModel.ts` 在这里算成 `ImageCardModel`。
//
// ⚠️ **query key 工厂写在拥有这条 query 的 hook 文件里**（`15 §2.1` / `28 §4` 写的
// `lib/queryKeys.ts` **磁盘上不存在**；仓内 10 个 key 工厂全是这个形态）。向导那边的
// `ImageSelect` 落地时直接 import 本文件的 `imageKeys`，两页共用同一份缓存——
// 「禁用后向导下拉自动移除」因此是缓存失效的自然结果，不需要任何跨页通知机制。
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listImages } from '@/services/api/image.service';
import { ApiErrorException } from '@/services/api/apiError';
import {
  useActivateImage,
  useCheckImageUpdate,
  useDeleteImage,
  useDisableImage,
  useRegisterImage,
  useRevalidateImage,
  useSaveImageConfig,
  useValidateImageRef,
} from '@/hooks/image/useImageMutations';
import { imageCardModel, shortenDigest } from '@/lib/image/imageCardModel';
import {
  cardValidationStatus,
  envRowsFromConfig,
  envSummary,
  groupManifestsByImage,
  manifestToCardInput,
  type ImageCardGroup,
} from '@/lib/image/imageManifestCards';
import { mapEnvErrorResponse } from '@/lib/image/mapEnvErrorResponse';
import { validateEnvVars } from '@/lib/image/validateEnvVar';
import { describeSandboxError } from '@/lib/sandbox/sandboxErrorCopy';
import { useAppStore } from '@/stores';
import type {
  EnvVarRowModel,
  EnvVarValidationError,
  ImageCardModel,
  ImageConfigInput,
  ImageManifestDto,
  ImageValidationResultData,
  ImageValidationStatus,
  ImageVersionRowModel,
  ValidationIssueDto,
} from '@/types/image';

/** 镜像专属 query key 工厂（15 §2.1，防 typo）。 */
export const imageKeys = {
  all: () => ['images'] as const,
  /** 管理页用 `list()`（不带 runtimeId ⇒ 后端连历史版本一起回）；向导用 `list(runtimeId)`。 */
  list: (runtimeId?: string) => [...imageKeys.all(), 'list', runtimeId ?? null] as const,
};

export function useImages(runtimeId?: string): UseQueryResult<ImageManifestDto[]> {
  return useQuery({
    queryKey: imageKeys.list(runtimeId),
    queryFn: () => listImages(runtimeId),
    staleTime: 60_000,
  });
}

/** 状态过滤（深链 `?filter=warning` 进入即应用）。 */
export type ImageStatusFilter = 'all' | ImageValidationStatus;

const STATUS_FILTERS: readonly string[] = ['all', 'valid', 'warning', 'invalid'];

/**
 * 深链初值。**刻意读 `window.location` 而不是 `useSearchParams()`**：后者在 Next 15 里会把
 * 整棵子树逼进 Suspense 边界（否则 `next build` 直接报错），而这里要的只是一个挂载时的初值，
 * 之后再没人观察它。读不到（SSR/测试环境无 location）就回落到 `'all'`。
 */
function initialStatusFilter(): ImageStatusFilter {
  if (typeof window === 'undefined') return 'all';
  const raw = new URLSearchParams(window.location.search).get('filter');
  if (raw === null || !STATUS_FILTERS.includes(raw)) return 'all';
  return raw === 'all'
    ? 'all'
    : raw === 'valid'
      ? 'valid'
      : raw === 'warning'
        ? 'warning'
        : 'invalid';
}

/** 一张卡渲染要的全部东西（container 只做装配，不再算任何派生值）。 */
export interface ImageCardViewModel {
  imageId: string;
  model: ImageCardModel;
  /** 卡面那一行的 manifest（保存 env / 删除 / 重验都作用在它身上）。 */
  manifestId: string;
  envSummary: string;
  /** 卡片背后的历史版本（含被下线的旧行，[切换到此版本] 就打在它们身上）。 */
  history: ImageVersionRowModel[];
  /** 最近一次 [检查更新] / [重新验证] 探到的上游新 digest（🔄 **蓝色**信息角标，不是告警）。 */
  upstreamUpdate?: { newDigestShort: string };
  revalidating: boolean;
  checkingUpdate: boolean;
  toggling: boolean;
}

/** 对比弹层：新旧 digest + 新版本三级结论 + 采纳方式。 */
export interface ImageCompareState {
  imageName: string;
  refDisplay: string;
  currentDigestShort: string;
  currentResolvedAtLabel?: string;
  upstreamDigestShort: string;
  upstreamValidation: ImageValidationResultData;
  /**
   * [更新到新版本] 到底要写什么：
   *  · `activate` —— 那一行 manifest **已经在库里**（重复粘贴同一个 URI 时后端已经 INSERT 了），
   *    只差把指针挪过去；
   *  · `register` —— [检查更新] 只是**探测**，什么都没写，所以要先 `POST /api/images`
   *    把新 digest 那一行插进来，再 activate 它。
   * 两条路都不是"改旧行"（I-IMG-7：manifest 行不可变）。
   */
  adopt: { kind: 'activate'; manifestId: string } | { kind: 'register'; ref: string };
}

/** 环境变量编辑草稿（受控，07 §3 规则 2：草稿只活在这里，不进 store）。 */
export interface EnvEditorState {
  manifestId: string;
  rows: EnvVarRowModel[];
  errors: EnvVarValidationError[];
  valueByteCounts: readonly number[];
  canAddRow: boolean;
  /** 后端 400 里归不了位的那些 + envelope 的 message（**不静默吞掉**）。 */
  generalError?: string;
  unmapped: readonly { message: string }[];
}

export interface PendingImageDelete {
  manifestId: string;
  imageName: string;
  version: string;
}

export interface ImagesManager {
  loading: boolean;
  /** 过滤后的卡片；`isEmpty` 区分"一张都没注册"与"过滤后为空"。 */
  cards: ImageCardViewModel[];
  noImagesAtAll: boolean;
  search: string;
  setSearch: (q: string) => void;
  statusFilter: ImageStatusFilter;
  setStatusFilter: (f: ImageStatusFilter) => void;
  /** [定位到该镜像] 后高亮的那张卡。 */
  highlightedImageId: string | null;

  // —— 注册弹窗（`currentModal === 'registerImage'`，真 overlay）——
  registerOpen: boolean;
  openRegister: () => void;
  closeRegister: () => void;
  uri: string;
  onUriChange: (next: string) => void;
  uriError?: string;
  validating: boolean;
  saving: boolean;
  validationResult?: ImageValidationResultData;
  conclusionInvalidated: boolean;
  duplicate?: { message: string };
  validate: () => void;
  save: () => void;
  locateExisting: () => void;

  // —— 卡片动作 ——
  revalidate: (manifestId: string) => void;
  checkUpdate: (manifestId: string) => void;
  toggle: (manifestId: string, next: boolean) => void;
  activateVersion: (manifestId: string) => void;
  requestDelete: (manifestId: string) => void;
  pendingDelete: PendingImageDelete | null;
  confirmDelete: () => void;
  cancelDelete: () => void;
  deleting: boolean;

  // —— 对比弹层 ——
  compare: ImageCompareState | null;
  adoptNewVersion: () => void;
  dismissCompare: () => void;
  adopting: boolean;

  /** 一键复制钉定 digest（"你跑的到底是哪个镜像"的唯一答案，得能贴进工单）。 */
  copyDigest: (digest: string) => void;
  /** ❌ 档唯一的出路（P22 §1：禁止只报错不给动作）。 */
  viewRequirements: () => void;

  // —— 运行参数 ——
  envEditor: EnvEditorState | null;
  openEnvEditor: (manifestId: string) => void;
  closeEnvEditor: () => void;
  changeEnvKey: (rowId: string, key: string) => void;
  changeEnvValue: (rowId: string, value: string) => void;
  toggleEnvSecret: (rowId: string, secret: boolean) => void;
  removeEnvRow: (rowId: string) => void;
  addEnvRow: () => void;
  saveEnv: () => void;
  savingEnv: boolean;
}

function issuesToText(issues: readonly ValidationIssueDto[]): string[] {
  return issues.map((i) => i.message);
}

/** 后端信封 → 一句人话。顶层码走 P22 §1 的那张表（`describeSandboxError`），不裸抛码。 */
function imageErrorToast(error: unknown, fallback: string): void {
  if (error instanceof ApiErrorException) {
    const copy = describeSandboxError({
      code: error.envelope.code,
      message: error.envelope.message,
    });
    toast.error(copy.title, { description: copy.advice });
    return;
  }
  toast.error(fallback);
}

const REVALIDATE_TOAST: Record<ImageValidationStatus, string> = {
  valid: '重新验证通过：该 digest 仍满足平台约定。',
  warning: '重新验证通过，但有警告——展开卡片看后果说明。',
  invalid: '重新验证不通过：平台校验规则已更新，该镜像现已不满足约定。',
};

export function useImageManager(): ImagesManager {
  const query = useImages();
  const currentModal = useAppStore((s) => s.currentModal);
  const setCurrentModal = useAppStore((s) => s.setCurrentModal);

  const validateMutation = useValidateImageRef();
  const registerMutation = useRegisterImage();
  const revalidateMutation = useRevalidateImage();
  const checkUpdateMutation = useCheckImageUpdate();
  const activateMutation = useActivateImage();
  const disableMutation = useDisableImage();
  const saveConfigMutation = useSaveImageConfig();
  const deleteMutation = useDeleteImage();

  // 搜索词是 container 局部 state：刷新即清、切走即清、不跨会话——正是 P21-4 §6 要的那三条。
  // ⚠️ **刻意不落 `localStorage.imageSearchQuery`**：那个键要的是「会话内保留 + 刷新不恢复」，
  // 而 localStorage 天生跨刷新，半实现出来的东西会在刷新后把上次的搜索词又填回去——
  // 与需求正好相反。要做就得连"离开设置区即清"的守卫一起做（`PendingCloneReturnGuard` 那种形态）。
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ImageStatusFilter>(initialStatusFilter);
  const [highlightedImageId, setHighlightedImageId] = useState<string | null>(null);

  const [uri, setUri] = useState('');
  /**
   * 「上一次被验证的那个 URI」。
   * ⚠️ 是 `useRef` 而不是 `useState`：它**不参与渲染**（界面看的是 `validationResult` 有没有、
   * `conclusionInvalidated` 真不真），只是 `onUriChange` 用来判"输入变了没有"的记账位。
   * 用 state 的话，`onUriChange` 就得在 setState 的 updater 里再调另外两个 setState——
   * updater 必须是纯函数，那种写法在 StrictMode 的双调用下会把 `conclusionInvalidated` 设两次。
   */
  const validatedUriRef = useRef<string | null>(null);
  const [validationResult, setValidationResult] = useState<ImageValidationResultData | undefined>(
    undefined,
  );
  const [conclusionInvalidated, setConclusionInvalidated] = useState(false);
  const [duplicate, setDuplicate] = useState<{ message: string; imageId: string } | undefined>(
    undefined,
  );

  const [upstreamByManifest, setUpstreamByManifest] = useState<Record<string, string>>({});
  const [compare, setCompare] = useState<ImageCompareState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingImageDelete | null>(null);
  const [envDraft, setEnvDraft] = useState<{
    manifestId: string;
    rows: EnvVarRowModel[];
    nextRowId: number;
    serverErrors: EnvVarValidationError[];
    generalError?: string;
    unmapped: { message: string }[];
  } | null>(null);

  const manifests = useMemo(() => query.data ?? [], [query.data]);
  const groups = useMemo(() => groupManifestsByImage(manifests), [manifests]);

  const cards = useMemo<ImageCardViewModel[]>(() => {
    const now = Date.now();
    const needle = search.trim().toLowerCase();
    return groups
      .filter((g) => {
        const status = cardValidationStatus(g.face.validationStatus);
        if (statusFilter !== 'all' && status !== statusFilter) return false;
        if (needle === '') return true;
        return (
          g.imageName.toLowerCase().includes(needle) || g.face.ref.toLowerCase().includes(needle)
        );
      })
      .map((g) => toCardViewModel(g, now, upstreamByManifest));
  }, [groups, search, statusFilter, upstreamByManifest]);

  const cardBusy = useCallback(
    (manifestId: string) => ({
      revalidating: revalidateMutation.isPending && revalidateMutation.variables === manifestId,
      checkingUpdate: checkUpdateMutation.isPending && checkUpdateMutation.variables === manifestId,
      toggling:
        (disableMutation.isPending && disableMutation.variables === manifestId) ||
        (activateMutation.isPending && activateMutation.variables === manifestId),
    }),
    [
      revalidateMutation.isPending,
      revalidateMutation.variables,
      checkUpdateMutation.isPending,
      checkUpdateMutation.variables,
      disableMutation.isPending,
      disableMutation.variables,
      activateMutation.isPending,
      activateMutation.variables,
    ],
  );

  const decoratedCards = useMemo(
    () => cards.map((card) => ({ ...card, ...cardBusy(card.manifestId) })),
    [cards, cardBusy],
  );

  const findManifest = useCallback(
    (manifestId: string): ImageManifestDto | undefined =>
      manifests.find((m) => m.id === manifestId),
    [manifests],
  );

  // ——— 注册弹窗 ———

  const closeRegister = useCallback(() => {
    setCurrentModal(null);
    setUri('');
    validatedUriRef.current = null;
    setValidationResult(undefined);
    setConclusionInvalidated(false);
    setDuplicate(undefined);
  }, [setCurrentModal]);

  const openRegister = useCallback(() => {
    setUri('');
    validatedUriRef.current = null;
    setValidationResult(undefined);
    setConclusionInvalidated(false);
    setDuplicate(undefined);
    setCurrentModal('registerImage');
  }, [setCurrentModal]);

  /**
   * 改动 URI ⇒ **结论整块清掉**（不是条件隐藏，P21-4 §5「⏳ 结论已作废」）。
   *
   * ⚠️ 「改回原值也不复活」**靠的是 `setValidationResult(undefined)` 这一句**——结论被**删掉**了，
   * 没有任何地方还留着它可以拿回来。**变异验证过**：去掉这一句（只置 `conclusionInvalidated`）
   * ⇒ hook 与 container 两条用例当场红；而只去掉下面那句 `validatedUriRef.current = null`
   * ⇒ **两条都仍然绿**——因为 result 已经没了，ref 指向哪儿都换不回一个绿勾。
   * 那一句留着是**语义自洽**（这个 ref 的含义是"当前这个结论属于哪个 URI"，结论没了它就不该
   * 还指着某个串），不是这条交互的防线；别把它当防线读。
   *
   * 判定按 **trim 后字符串是否变化**，不做任何等价归一（`docker.io/x` 与 `x` 算两个输入）。
   */
  const onUriChange = useCallback((next: string) => {
    setUri(next);
    setDuplicate(undefined);
    const previous = validatedUriRef.current;
    if (previous === null || next.trim() === previous) return;
    validatedUriRef.current = null;
    setValidationResult(undefined);
    setConclusionInvalidated(true);
  }, []);

  const uriError = useMemo(() => {
    const raw = uri.trim();
    if (raw === '') return undefined;
    // 与后端 `INVALID_IMAGE_REFERENCE`（空白/控制字符）同口径的**即时**提示；
    // 最终判定仍在后端，前端只提前说一声，**永不放宽**（07 §8.3.1 纪律 3）。
    return /\s/.test(raw) ? '镜像地址不能包含空格、换行或不可见字符。' : undefined;
  }, [uri]);

  const validate = useCallback(() => {
    const ref = uri.trim();
    if (ref === '') return;
    validateMutation.mutate(ref, {
      onSuccess: (outcome) => {
        validatedUriRef.current = ref;
        setConclusionInvalidated(false);
        // ⚠️ **这里回显不了 digest**：P21-4 §6 要求「并回显本次解析出的 digest」，而
        // `ValidationOutcomeResponseDto` 契约里只有 `{status, errors, warnings}`——没有 digest。
        // 于是 `pinnedDigestShort` 缺席。**不编一个**：预检阶段编出来的短哈希会被读成"已钉定"，
        // 而这一步后端明确什么都没落库。缺口登记在此，等契约补 digest 字段。
        setValidationResult({
          status: cardValidationStatus(outcome.status),
          warnings: issuesToText(outcome.warnings),
          errors: issuesToText(outcome.errors),
        });
      },
      onError: (error) => {
        imageErrorToast(error, '验证失败，请稍后重试。');
      },
    });
  }, [uri, validateMutation]);

  const save = useCallback(() => {
    const ref = uri.trim();
    if (ref === '') return;
    registerMutation.mutate(ref, {
      onSuccess: (result) => {
        if (!result.created) {
          // 重复注册**不当错误吓唬用户**（P21-4 §6）：就地提示 + [定位到该镜像]。
          setDuplicate({
            message: `该镜像已注册（${result.manifest.ref}，钉定 ${shortenDigest(result.manifest.digest)}）。`,
            imageId: result.manifest.imageId,
          });
          return;
        }
        if (!result.manifest.isActive) {
          // 同一个 tag 解出了**新的** digest：后端插了一行、但没有替用户换镜像。
          // 这正是 [检查更新] 那条路的终点，于是直接复用同一个对比弹层（P21-4 §6）。
          const live = manifests.find((m) => m.imageId === result.manifest.imageId && m.isActive);
          closeRegister();
          setCompare({
            imageName: result.manifest.imageName,
            refDisplay: result.manifest.ref,
            currentDigestShort: live === undefined ? '（未知）' : shortenDigest(live.digest),
            upstreamDigestShort: shortenDigest(result.manifest.digest),
            upstreamValidation: {
              status: cardValidationStatus(result.validation.status),
              warnings: issuesToText(result.validation.warnings),
              errors: issuesToText(result.validation.errors),
            },
            adopt: { kind: 'activate', manifestId: result.manifest.id },
          });
          return;
        }
        closeRegister();
        toast.success(`已注册并钉定 ${shortenDigest(result.manifest.digest)}`);
      },
      onError: (error) => {
        imageErrorToast(error, '注册失败，请稍后重试。');
      },
    });
  }, [uri, registerMutation, manifests, closeRegister]);

  const locateExisting = useCallback(() => {
    if (duplicate !== undefined) setHighlightedImageId(duplicate.imageId);
    closeRegister();
  }, [duplicate, closeRegister]);

  // ——— 卡片动作 ———

  const revalidate = useCallback(
    (manifestId: string) => {
      revalidateMutation.mutate(manifestId, {
        onSuccess: (outcome) => {
          if (outcome.digestChanged) {
            // 后端**没有**写回新结论（它描述的是另一堆 bits）。所以这里也不能说"验证通过/不通过"，
            // 只能说"上游换人了"——这正是 [重新验证] 与 [检查更新] 分成两颗按钮的意义。
            setUpstreamByManifest((prev) => ({ ...prev, [manifestId]: outcome.upstreamDigest }));
            toast.info(
              `上游该 tag 已指向新镜像（${shortenDigest(outcome.upstreamDigest)}）；当前版本的结论未变。点 [检查更新] 看对比。`,
            );
            return;
          }
          toast.success(REVALIDATE_TOAST[cardValidationStatus(outcome.status)]);
        },
        onError: (error) => {
          imageErrorToast(error, '重新验证失败，请稍后重试。');
        },
      });
    },
    [revalidateMutation],
  );

  const checkUpdate = useCallback(
    (manifestId: string) => {
      const manifest = findManifest(manifestId);
      checkUpdateMutation.mutate(manifestId, {
        onSuccess: (result) => {
          if (result.upstream === null) {
            toast.info(
              '上游已经找不到这个 tag 了。当前钉定的版本仍然可以正常拉取，只是没有可更新的目标。',
            );
            return;
          }
          if (!result.changed) {
            toast.success(`已是最新（${shortenDigest(result.upstream.digest)}）`);
            return;
          }
          const upstreamDigest = result.upstream.digest;
          setUpstreamByManifest((prev) => ({ ...prev, [manifestId]: upstreamDigest }));
          if (manifest === undefined) return;
          const model = imageCardModel(manifestToCardInput(manifest));
          setCompare({
            imageName: manifest.imageName,
            refDisplay: model.refDisplay,
            currentDigestShort: shortenDigest(result.current.digest),
            ...(model.resolvedAtLabel === undefined
              ? {}
              : { currentResolvedAtLabel: model.resolvedAtLabel }),
            upstreamDigestShort: shortenDigest(upstreamDigest),
            upstreamValidation: {
              status: cardValidationStatus(result.upstream.validation.status),
              warnings: issuesToText(result.upstream.validation.warnings),
              errors: issuesToText(result.upstream.validation.errors),
            },
            // [检查更新] 只探测、什么都没写 ⇒ 采纳时要先把新行 INSERT 出来再 activate。
            adopt: { kind: 'register', ref: manifest.ref },
          });
        },
        onError: (error) => {
          imageErrorToast(error, '检查更新失败，请稍后重试。');
        },
      });
    },
    [checkUpdateMutation, findManifest],
  );

  const activateVersion = useCallback(
    (manifestId: string) => {
      activateMutation.mutate(manifestId, {
        onSuccess: () => {
          toast.success('已切换到该版本。');
        },
        onError: (error) => {
          imageErrorToast(error, '切换版本失败，请稍后重试。');
        },
      });
    },
    [activateMutation],
  );

  /**
   * [禁用]/[启用]。
   * ⚠️ **两个方向走两个端点**：禁用是 `PATCH { isActive:false }`（可乐观），
   * 启用是 `POST /:id/activate`——`PATCH { isActive:true }` 后端明确回 400 并指向 activate，
   * 所以"把 next 直接塞进 PATCH"这种写法在这里是**一定会 400** 的写法。
   */
  const toggle = useCallback(
    (manifestId: string, next: boolean) => {
      if (next) {
        activateVersion(manifestId);
        return;
      }
      disableMutation.mutate(manifestId, {
        onSuccess: () => {
          toast.success('已禁用，向导下拉里不再出现这张镜像。');
        },
        onError: (error) => {
          imageErrorToast(error, '禁用失败，已回滚。');
        },
      });
    },
    [activateVersion, disableMutation],
  );

  const requestDelete = useCallback(
    (manifestId: string) => {
      const manifest = findManifest(manifestId);
      if (manifest === undefined) return;
      setPendingDelete({
        manifestId,
        imageName: manifest.imageName,
        version: manifest.version,
      });
    },
    [findManifest],
  );

  const confirmDelete = useCallback(() => {
    if (pendingDelete === null) return;
    deleteMutation.mutate(pendingDelete.manifestId, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success('已删除。');
      },
      onError: (error) => {
        // 被引用 / 预置镜像 → 后端 409 `INVALID_STATE`，message 里带着"被 N 个 Task 引用"。
        // 弹层**留在原地**，用户读完那句话自己决定改成禁用。
        imageErrorToast(error, '删除失败，请稍后重试。');
      },
    });
  }, [pendingDelete, deleteMutation]);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  // ——— 对比弹层 ———

  const dismissCompare = useCallback(() => {
    // [暂不更新]：**保留当前 digest**，什么都不写。角标留着（上游确实有新版本）。
    setCompare(null);
  }, []);

  const adoptNewVersion = useCallback(() => {
    if (compare === null) return;
    if (compare.adopt.kind === 'activate') {
      const manifestId = compare.adopt.manifestId;
      activateMutation.mutate(manifestId, {
        onSuccess: () => {
          setCompare(null);
          toast.success('已更新到新版本。');
        },
        onError: (error) => {
          imageErrorToast(error, '更新失败，请稍后重试。');
        },
      });
      return;
    }
    const ref = compare.adopt.ref;
    registerMutation.mutate(ref, {
      onSuccess: (result) => {
        // 注册把新 digest 那一行插了进来（或者发现它已经在库里），再把指针挪过去。
        // **两步都不是"改旧行"**：旧行原样留着，历史 Task 的镜像溯源不受影响（I-IMG-7）。
        activateMutation.mutate(result.manifest.id, {
          onSuccess: () => {
            setCompare(null);
            toast.success(`已更新到新版本（${shortenDigest(result.manifest.digest)}）。`);
          },
          onError: (error) => {
            imageErrorToast(error, '更新失败，请稍后重试。');
          },
        });
      },
      onError: (error) => {
        imageErrorToast(error, '更新失败，请稍后重试。');
      },
    });
  }, [compare, activateMutation, registerMutation]);

  /**
   * 复制 digest。剪贴板 API 是副作用 ⇒ 归 hook（07 §3 规则 2），view 只给一个回调。
   * ⚠️ 不假设它一定成功：非安全上下文（http 的局域网部署）里 `navigator.clipboard` 干脆不存在，
   * 静默失败会让用户以为复制到了、粘出来是上一次的东西。
   */
  const copyDigest = useCallback((digest: string) => {
    void (async () => {
      try {
        // 非安全上下文里 `navigator.clipboard` 干脆不存在，读 `.writeText` 当场抛 TypeError；
        // 连同权限被拒的那条路一起接住——静默失败会让用户以为复制到了，粘出来却是上一次的东西。
        await navigator.clipboard.writeText(digest);
        toast.success('digest 已复制。');
      } catch {
        toast.error('复制失败（需要 HTTPS 或 localhost 才允许自动复制），请手动选中复制。');
      }
    })();
  }, []);

  /**
   * [查看镜像要求]。⚠️ 这三条是**后端校验真正在判的东西**（04 §7 / `oci-image-spec.provider.ts`：
   * `IMAGE_TMUX_MISSING` / `IMAGE_ENTRYPOINT_INVALID` / `RUNTIME_NOT_PREINSTALLED`），
   * 不是一段泛泛的"请使用合规镜像"。写错一条，用户照着改了还是过不了。
   */
  const viewRequirements = useCallback(() => {
    toast.info('平台对镜像的三条要求', {
      description:
        '① 必须声明 label `platform.tmux=true`（断线恢复靠它，缺了不做静默降级）；' +
        '② 必须有 `Entrypoint` 或 `Cmd`，且有 `WorkingDir`；' +
        '③ 建议在 `platform.supportedRuntimes` 里声明的 runtime 都已预装 CLI——没预装只是 ⚠️ 警告，' +
        '创建时现装可用，但按分钟计（实测约 12.5 分钟）。',
    });
  }, []);

  // ——— 运行参数（env）———

  const openEnvEditor = useCallback(
    (manifestId: string) => {
      const manifest = findManifest(manifestId);
      if (manifest === undefined) return;
      const rows = envRowsFromConfig(manifest.imageConfig);
      setEnvDraft({
        manifestId,
        rows,
        nextRowId: rows.length,
        serverErrors: [],
        unmapped: [],
      });
    },
    [findManifest],
  );

  const closeEnvEditor = useCallback(() => {
    setEnvDraft(null);
  }, []);

  /** 任何一次行编辑都作废上一轮的**后端**错误——它们说的是上一次提交的那份表。 */
  const editRows = useCallback((mutate: (rows: EnvVarRowModel[]) => EnvVarRowModel[]) => {
    setEnvDraft((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            rows: mutate(prev.rows),
            serverErrors: [],
            unmapped: [],
            generalError: undefined,
          },
    );
  }, []);

  const changeEnvKey = useCallback(
    (rowId: string, key: string) => {
      editRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, key } : r)));
    },
    [editRows],
  );

  /**
   * 已存 secret 的行一被输入，就**不再是"保持不变"那一行**了 ⇒ 清掉 `secretStored`，
   * 输入框从"空 + （保持不变，输入即覆盖）"变成正常受控输入。
   */
  const changeEnvValue = useCallback(
    (rowId: string, value: string) => {
      editRows((rows) =>
        rows.map((r) => (r.id === rowId ? { ...r, value, secretStored: false } : r)),
      );
    },
    [editRows],
  );

  const toggleEnvSecret = useCallback(
    (rowId: string, secret: boolean) => {
      editRows((rows) =>
        rows.map((r) =>
          r.id === rowId
            ? // 取消勾选 secret ⇒ 库里那份密文不再适用，这一行必须重新填明文。
              { ...r, secret, secretStored: secret ? r.secretStored : false }
            : r,
        ),
      );
    },
    [editRows],
  );

  const removeEnvRow = useCallback(
    (rowId: string) => {
      editRows((rows) => rows.filter((r) => r.id !== rowId));
    },
    [editRows],
  );

  const addEnvRow = useCallback(() => {
    setEnvDraft((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            // 行 id 单调递增：删了再加不会撞上已删行的 key。
            rows: [
              ...prev.rows,
              {
                id: `env-new-${String(prev.nextRowId)}`,
                key: '',
                value: '',
                secret: false,
                secretStored: false,
              },
            ],
            nextRowId: prev.nextRowId + 1,
            serverErrors: [],
            unmapped: [],
            generalError: undefined,
          },
    );
  }, []);

  // 前端预检**每次渲染都跑**（纯函数、零成本），view 只吃结果。
  const localEnv = useMemo(
    () => (envDraft === null ? null : validateEnvVars(envDraft.rows)),
    [envDraft],
  );

  const envEditor = useMemo<EnvEditorState | null>(() => {
    if (envDraft === null || localEnv === null) return null;
    return {
      manifestId: envDraft.manifestId,
      rows: envDraft.rows,
      errors: [...localEnv.errors, ...envDraft.serverErrors],
      valueByteCounts: localEnv.valueByteCounts,
      canAddRow: localEnv.canAddRow,
      ...(envDraft.generalError === undefined ? {} : { generalError: envDraft.generalError }),
      unmapped: envDraft.unmapped,
    };
  }, [envDraft, localEnv]);

  const saveEnv = useCallback(() => {
    if (envDraft === null || localEnv === null) return;
    if (localEnv.errors.length > 0) {
      // 前端预检没过就不发请求：后端会拿同样的四个码拒回来，白跑一趟网络。
      toast.error('运行参数还有未修正的问题，请按行内提示改完再保存。');
      return;
    }
    const imageConfig: ImageConfigInput = {
      // ⚠️ secret 行的 value 保持 `''` = **保持不变**（后端 I-IMG-5）。原值从来没有进过 props，
      // 所以这里也拿不到、也不需要拿。
      env: envDraft.rows.map((r) => ({ key: r.key, value: r.value, secret: r.secret })),
    };
    saveConfigMutation.mutate(
      { id: envDraft.manifestId, imageConfig },
      {
        onSuccess: () => {
          setEnvDraft(null);
          toast.success('运行参数已保存。');
        },
        onError: (error) => {
          if (!(error instanceof ApiErrorException)) {
            toast.error('保存失败，请稍后重试。');
            return;
          }
          // 后端 400 按 `details[].path` **逐行归位**，不整表报错（F21-4 §5）。
          // 归不了位的（未知码 / 指向已删除的行）连同 message 走整体提示，**不吞**。
          const mapped = mapEnvErrorResponse(error.envelope, envDraft.rows.length);
          setEnvDraft((prev) =>
            prev === null
              ? prev
              : {
                  ...prev,
                  serverErrors: mapped.rowErrors,
                  unmapped: mapped.unmapped,
                  ...(mapped.generalMessage === undefined
                    ? { generalError: undefined }
                    : { generalError: mapped.generalMessage }),
                },
          );
          if (mapped.rowErrors.length === 0) {
            imageErrorToast(error, '保存失败，请稍后重试。');
          }
        },
      },
    );
  }, [envDraft, localEnv, saveConfigMutation]);

  return {
    loading: query.isPending,
    cards: decoratedCards,
    noImagesAtAll: !query.isPending && manifests.length === 0,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    highlightedImageId,

    registerOpen: currentModal === 'registerImage',
    openRegister,
    closeRegister,
    uri,
    onUriChange,
    ...(uriError === undefined ? {} : { uriError }),
    validating: validateMutation.isPending,
    saving: registerMutation.isPending,
    ...(validationResult === undefined ? {} : { validationResult }),
    conclusionInvalidated,
    ...(duplicate === undefined ? {} : { duplicate: { message: duplicate.message } }),
    validate,
    save,
    locateExisting,

    revalidate,
    checkUpdate,
    toggle,
    activateVersion,
    requestDelete,
    pendingDelete,
    confirmDelete,
    cancelDelete,
    deleting: deleteMutation.isPending,

    compare,
    adoptNewVersion,
    dismissCompare,
    adopting: activateMutation.isPending || registerMutation.isPending,
    copyDigest,
    viewRequirements,

    envEditor,
    openEnvEditor,
    closeEnvEditor,
    changeEnvKey,
    changeEnvValue,
    toggleEnvSecret,
    removeEnvRow,
    addEnvRow,
    saveEnv,
    savingEnv: saveConfigMutation.isPending,
  };
}

function toCardViewModel(
  group: ImageCardGroup,
  now: number,
  upstreamByManifest: Record<string, string>,
): ImageCardViewModel {
  const model = imageCardModel(manifestToCardInput(group.face), now);
  const upstreamDigest = upstreamByManifest[group.face.id];
  return {
    imageId: group.imageId,
    manifestId: group.face.id,
    model,
    envSummary: envSummary(group.face.imageConfig),
    history: group.history,
    ...(upstreamDigest === undefined
      ? {}
      : { upstreamUpdate: { newDigestShort: shortenDigest(upstreamDigest) } }),
    revalidating: false,
    checkingUpdate: false,
    toggling: false,
  };
}
