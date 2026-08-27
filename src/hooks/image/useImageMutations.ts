// 镜像 mutation（F21-4 §4/§5.1，15 §2.4）。八个端点里的七个写/探测动作各一个 hook。
//
// ⚠️ **乐观更新只有一条边**（F21-4 §5.1 那张表）：
//   · `disableImage`（`isActive:false`）✅ 做 —— 布尔翻转，失败回滚代价为零；
//   · `activateImage` ❌ **不做** —— 它在**服务端一个事务里**把同 tag 的其它行一起下线，
//     前端猜"哪几行会跟着变"必然猜错，猜错的那一瞬间界面上会同时出现两行活的；
//   · `saveImageConfig` ❌ 不做 —— 校验可能失败，乐观改要回滚一整张表；
//   · `revalidateImage` / `checkImageUpdate` ❌ **不做，而且更严** —— 结果是"服务端怎么判"，
//     前端连猜的依据都没有。乐观把卡片刷成 ✅ 而后端返回 ❌，那一瞬间用户看到的是
//     **平台自己编出来的结论**。
//
// 这条纪律唯一能被证伪的形态是：**`onMutate` 不存在、`setQueryData` 在服务端返回前一次都没被调用**。
// `__tests__/useImages.test.tsx` 就是这么断言的——不是断言"最终值对"，那种断言乐观更新也能过。
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type QueryClient,
} from '@tanstack/react-query';
import {
  activateImage,
  checkImageUpdate,
  deleteImage,
  disableImage,
  registerImage,
  revalidateImage,
  saveImageConfig,
  validateImageRef,
} from '@/services/api/image.service';
// ⚠️ **这是一条 hook ↔ hook 的循环 import**（`useImages.ts` 也 import 本文件）。
// 它是"key 工厂写在拥有该 query 的 hook 文件里"这条仓内惯例的直接后果，
// 而**只在函数体里读 `imageKeys`（求值发生在调用时）才安全**——
// 谁要是在模块顶层写 `const K = imageKeys.list()`，先加载的那一侧会拿到 undefined。
// 已实测：`pnpm test` 与 `pnpm build`（Next 生产构建，`/settings/images` 正常预渲染）都通得过。
import { imageKeys } from '@/hooks/image/useImages';
import type {
  CheckImageUpdateDto,
  ImageConfigInput,
  ImageManifestDto,
  RegisterImageResult,
  RevalidateOutcomeDto,
  ValidationOutcomeDto,
} from '@/types/image';

function invalidateImages(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: imageKeys.all() });
}

/** `POST /api/images/validate` —— 注册前预检。**不落库 ⇒ 不 invalidate**（没有任何缓存会因它变旧）。 */
export function useValidateImageRef(): UseMutationResult<ValidationOutcomeDto, Error, string> {
  return useMutation({ mutationFn: validateImageRef });
}

/** `POST /api/images` —— 注册。`created` 由 HTTP 状态位承载（见 service）。 */
export function useRegisterImage(): UseMutationResult<RegisterImageResult, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerImage,
    onSuccess: () => {
      invalidateImages(queryClient);
    },
  });
}

/**
 * `POST /api/images/:id/validate` —— 对已钉定的 digest 重跑校验。
 * ⚠️ 无 `onMutate`：三级结论与 digest 在服务端返回前**一个字都不改**。
 */
export function useRevalidateImage(): UseMutationResult<RevalidateOutcomeDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revalidateImage,
    onSuccess: () => {
      invalidateImages(queryClient);
    },
  });
}

/**
 * `POST /api/images/:id/check-update` —— 重解 tag 比对 digest。
 * ⚠️ 后端**什么都不写**，所以这里也**不 invalidate**：invalidate 会让整列表重取一次，
 * 而没有任何一行发生过变化——那次重取只会让卡片闪一下，还容易被读成"检查更新改了什么"。
 */
export function useCheckImageUpdate(): UseMutationResult<CheckImageUpdateDto, Error, string> {
  return useMutation({ mutationFn: checkImageUpdate });
}

/**
 * `POST /api/images/:id/activate` —— 「更新到新版本」与「回滚到旧版本」共用的那一个动作，
 * 也是**启用一张被禁用镜像**的唯一入口（`PATCH { isActive:true }` 后端 400）。
 * ⚠️ 不做乐观更新：同 tag 的其它行会被后端一并下线，前端猜不出是哪几行。
 */
export function useActivateImage(): UseMutationResult<ImageManifestDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: activateImage,
    onSuccess: () => {
      invalidateImages(queryClient);
    },
  });
}

/** 乐观回滚用的上下文：整份列表快照。 */
interface DisableContext {
  previous?: ImageManifestDto[];
}

/**
 * `PATCH /api/images/:id { isActive:false }` —— **唯一做乐观更新的一条边**。
 * 失败时整份快照回滚（15 §2.4），成功/失败都 invalidate 一次以服务端为准。
 */
export function useDisableImage(): UseMutationResult<
  ImageManifestDto,
  Error,
  string,
  DisableContext
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disableImage,
    onMutate: async (id): Promise<DisableContext> => {
      // 不取消在途请求的话，一个先发出的 GET 会在乐观写之后落地，把开关又"翻回去"。
      await queryClient.cancelQueries({ queryKey: imageKeys.list() });
      const previous = queryClient.getQueryData<ImageManifestDto[]>(imageKeys.list());
      if (previous !== undefined) {
        queryClient.setQueryData<ImageManifestDto[]>(
          imageKeys.list(),
          previous.map((m) => (m.id === id ? { ...m, isActive: false } : m)),
        );
      }
      return previous === undefined ? {} : { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(imageKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      invalidateImages(queryClient);
    },
  });
}

/**
 * `PATCH /api/images/:id { imageConfig }` —— 保存运行参数。
 * ⚠️ 不做乐观更新（校验可能失败，回滚要回滚一整张表），也**只发 imageConfig 这一半**（见 service）。
 */
export function useSaveImageConfig(): UseMutationResult<
  ImageManifestDto,
  Error,
  { id: string; imageConfig: ImageConfigInput }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, imageConfig }) => saveImageConfig(id, imageConfig),
    onSuccess: () => {
      invalidateImages(queryClient);
    },
  });
}

/** `DELETE /api/images/:id` —— 硬删一行；被引用/预置镜像由后端 409 挡住。 */
export function useDeleteImage(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteImage,
    onSuccess: () => {
      invalidateImages(queryClient);
    },
  });
}
