import { useImages } from '@/hooks/image/useImages';
import { launchImageOptions } from '@/lib/image/launchImageOptions';
import { groupManifestsByImage } from '@/lib/image/imageManifestCards';
import { ApiErrorException } from '@/services/api/apiError';
import type { TaskImageSnapshot } from '@/types/image';

export function launchQueryErrorMessage(error: Error): string {
  return error instanceof ApiErrorException ? '服务出错了' : '网络请求失败';
}

export function useLaunchImages(
  provider: string | undefined,
  runtime: string,
  runtimeName: string,
  pickedImage: string,
  originalImage: TaskImageSnapshot | undefined,
) {
  const images = useImages(undefined, provider);
  const choices = launchImageOptions(
    images.isError ? [] : (images.data ?? []),
    provider,
    runtime,
    runtimeName,
  );
  const originalManifest = pickedImage.startsWith('manifest:')
    ? images.data?.find((manifest) => manifest.id === pickedImage.slice('manifest:'.length))
    : undefined;
  const originalGroup =
    originalManifest === undefined
      ? undefined
      : groupManifestsByImage(images.data ?? []).find(
          (group) => group.imageId === originalManifest.imageId,
        );
  const effectiveImage = pickedImage.startsWith('manifest:')
    ? originalGroup?.face.isProviderDefault === true
      ? ''
      : (originalGroup?.imageId ?? pickedImage)
    : pickedImage;
  const selectedImage = choices.options.find((option) => option.value === effectiveImage);
  const disabledReason =
    effectiveImage === ''
      ? choices.defaultDisabledReason
      : selectedImage === undefined
        ? images.isPending
          ? '正在确认原任务用的镜像，请稍候。'
          : '原任务用的镜像现在不能用（已删除、验证没通过或跑不在这台机器上）：请改选一张镜像。'
        : selectedImage.disabled
          ? `原任务用的镜像「${selectedImage.reference}」现在不能用（${selectedImage.reason ?? '无效'}）：改选一张，或到「镜像管理」${selectedImage.reason === '已禁用' ? '重新启用它' : '处理好再回来'}。`
          : undefined;
  const options =
    effectiveImage !== '' && selectedImage === undefined
      ? [
          ...choices.options,
          {
            value: effectiveImage,
            reference: originalImage?.reference ?? '',
            label: `${originalImage?.reference ?? '原任务用的镜像'}（当前不可用）`,
            disabled: true,
          },
        ]
      : choices.options;
  return {
    options: images.isError && pickedImage === '' ? [] : options,
    effectiveImage,
    selectedImage,
    disabledReason,
    defaultLabel: choices.defaultLabel,
    isPending: images.isPending,
    errorMessage: images.isError
      ? pickedImage === ''
        ? '镜像列表暂时取不到，这次会用平台预制镜像。'
        : '镜像列表暂时取不到，无法确认原任务用的镜像；请改用平台预制镜像，或稍后再试。'
      : undefined,
  };
}
