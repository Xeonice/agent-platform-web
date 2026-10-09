// 镜像 REST（F21-4 §8.1，10 §6.4 / 27 §6 的 8 个端点）：走全站唯一 typed apiClient
// （与 project / gitCredential.service 一致），路径/参数/响应全部受生成 openapi.d.ts 约束
// —— 改后端契约 → `pnpm generate:api` → 此处编译期报红。
//
// ⚠️ **本文件最要紧的两条纪律，都是"方法怎么切"而不是"怎么发请求"**：
//
// ① **两个 validate 端点不可互换**（审计 P1-3）。`validateImageRef` 打
//    `POST /api/images/validate`（注册前预检，**不落库**）；`revalidateImage` 打
//    `POST /api/images/:id/validate`（对**已钉定的 digest** 重跑校验，会写回结论）。
//    把后者拿来顶前者、或者反过来，界面看起来都"能用"，但一个会凭空落一行、
//    另一个会对着不存在的 id 发请求。它们**不是一个方法的两种参数**。
//
// ② **`PATCH` 的独立编辑方法各自只发自己的字段，且没有任何方法能发 `isActive:true`**。
//    `disableImage(id)` **不收布尔参数**——不是"传 false"，是**根本没有那个入口**：
//    后端对 `isActive:true` 明确回 400 并指向 `/activate`（controller 注释写死了），
//    一个 `setActive(id, next: boolean)` 式的签名等于把那个 400 留在类型系统里当合法调用。
//    启用/切版本一律走 `activateImage(id)`。
//    `saveImageConfig` 同理只发 `imageConfig`：`GET /api/images` 的行里 `imageConfig` 是
//    **可能为 null** 的，整体 PUT 会把用户的环境变量冲掉，而界面上看不出任何异常。
//    `saveImageAlias` 只发 `alias`，不顺带改版本或运行参数，并核对服务端确认的别名。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type {
  CheckImageUpdateDto,
  ImageConfigInput,
  ImageManifestDto,
  ImageDeletionPreviewDto,
  RegisterImageResult,
  RevalidateOutcomeDto,
  ValidationOutcomeDto,
} from '@/types/image';

/**
 * `GET /api/images` —— 不带 `runtimeId` 时**连历史版本一起回**（管理页要的就是这个）；
 * 带 `runtimeId` 时后端只回向导可选集（`is_active ∧ 非 invalid ∧ 支持该 runtime`）。
 * ⚠️ 管理页**永远不传** `runtimeId`：传了就看不见历史版本，也就没法回滚。
 */
export async function listImages(
  runtimeId?: string,
  provider?: string,
): Promise<ImageManifestDto[]> {
  const { data, error, response } = await apiClient.GET('/api/images', {
    params: {
      query: {
        ...(runtimeId === undefined ? {} : { runtimeId }),
        ...(provider === undefined ? {} : { provider }),
      },
    },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** `POST /api/images/validate` —— 注册**前**预检：resolve + 判定，**什么都不落库**。 */
export async function validateImageRef(ref: string): Promise<ValidationOutcomeDto> {
  const { data, error, response } = await apiClient.POST('/api/images/validate', {
    body: { ref },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * `POST /api/images` —— 注册：resolve → validate → 钉定 digest。
 *
 * ⚠️ **200 与 201 是两件事，而 body 一模一样**：201 = 新插了一行；200 = 这个 digest 库里
 * 已经有了（用户把同一个 URI 又粘了一遍）。后端刻意不把这一位放进 body（同一个事实两个来源），
 * 所以只能在这里从 `response.status` 提出来——hook 拿 `created` 分岔（重复注册走"就地提示 +
 * [定位到该镜像]"，不是弹一个错误）。
 */
export async function registerImage(
  input: string | { ref: string; copyConfigFromId?: string; alias?: string },
): Promise<RegisterImageResult> {
  const { data, error, response } = await apiClient.POST('/api/images', {
    body: typeof input === 'string' ? { ref: input } : input,
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  if (
    typeof input !== 'string' &&
    input.alias !== undefined &&
    data.manifest.imageAlias !== input.alias
  ) {
    throw new Error('服务未确认镜像别名，请刷新后检查或重试。');
  }
  return { ...data, created: response.status === 201 };
}

/** 独立保存整张镜像的别名，只发送 alias，不改版本或运行参数。 */
export async function saveImageAlias(id: string, alias: string | null): Promise<ImageManifestDto> {
  const { data, error, response } = await apiClient.PATCH('/api/images/{id}', {
    params: { path: { id } },
    body: { alias },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  if (data.imageAlias !== alias) {
    throw new Error('服务未确认镜像别名，原别名仍保留，请刷新后检查或重试。');
  }
  return data;
}

/**
 * `POST /api/images/:id/validate` —— 对**已注册**的这一行重跑校验（04 §7 时刻②）。
 * 回来的 `digestChanged` 说的是"上游这个 tag 现在指向别的 bits 了"；此时后端**不写回**新结论
 * （那是另一堆 bits 的结论），行本身一个字不变。
 */
export async function revalidateImage(id: string): Promise<RevalidateOutcomeDto> {
  const { data, error, response } = await apiClient.POST('/api/images/{id}/validate', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * `POST /api/images/:id/check-update` —— 重解 tag、比对 digest，**什么都不写**。
 * `upstream === null` 表示上游连这个 tag 都没了（钉定的 digest 仍能拉，所以这是信息不是失败）；
 * 以 digest 注册的行调它会 409（没有 tag 可解），所以卡片上该按钮本来就是置灰的。
 */
export async function checkImageUpdate(id: string): Promise<CheckImageUpdateDto> {
  const { data, error, response } = await apiClient.POST('/api/images/{id}/check-update', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * `POST /api/images/:id/activate` —— 把这一行变成该 tag 的当前版本。
 * **同一个动作同时是「更新到新版本」和「回滚到旧版本」**（后端在一个事务里下线同 tag 的其它行）。
 * ⚠️ 「启用一张被禁用的镜像」也走这里，**不是** `PATCH { isActive: true }`（后端 400）。
 */
export async function activateImage(id: string): Promise<ImageManifestDto> {
  const { data, error, response } = await apiClient.POST('/api/images/{id}/activate', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * `PATCH /api/images/:id { isActive: false }` —— 软下线。
 * ⚠️ **没有布尔参数是刻意的**（见文件头纪律 ②）：这个函数只会发 `false`，
 * 想发 `true` 的人必须去找 `activateImage`，而那正是后端唯一接受的入口。
 */
export async function disableImage(id: string): Promise<ImageManifestDto> {
  const { data, error, response } = await apiClient.PATCH('/api/images/{id}', {
    params: { path: { id } },
    body: { isActive: false },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * `PATCH /api/images/:id { imageConfig }` —— 保存运行参数。
 * ⚠️ body 里**只有** `imageConfig`：带上 `isActive` 就会在保存环境变量时顺手改启停状态。
 * ⚠️ secret 行传空 value = **保持不变**（后端 I-IMG-5，与「（保持不变，输入即覆盖）」placeholder 同源），
 * 所以"打开面板直接保存"是安全的无操作，而不是把所有 secret 清空。
 */
export async function saveImageConfig(
  id: string,
  imageConfig: ImageConfigInput,
): Promise<ImageManifestDto> {
  const { data, error, response } = await apiClient.PATCH('/api/images/{id}', {
    params: { path: { id } },
    body: { imageConfig },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** `DELETE /api/images/:id` —— 硬删一行 manifest；被引用或预置镜像 → 409（INVALID_STATE）。 */
export async function deleteImage(id: string): Promise<void> {
  const { error, response } = await apiClient.DELETE('/api/images/{id}', {
    params: { path: { id } },
  });
  if (!response.ok) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
}

/** 只读清单，失败不能冒充零引用。 */
export async function getImageDeletionPreview(id: string): Promise<ImageDeletionPreviewDto> {
  const { data, error, response } = await apiClient.GET('/api/images/{id}/deletion-preview', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined)
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  return data;
}
