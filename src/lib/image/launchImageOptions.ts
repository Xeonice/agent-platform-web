import { groupManifestsByImage } from '@/lib/image/imageManifestCards';
import type { ImageManifestDto, LaunchImageOption, TaskImageSnapshot } from '@/types/image';

export function launchImageOptions(
  manifests: readonly ImageManifestDto[],
  provider: string | undefined,
  runtime: string,
  runtimeName: string,
): { options: LaunchImageOption[]; defaultDisabledReason?: string; defaultLabel: string } {
  const groups = groupManifestsByImage(manifests).filter(
    ({ face }) => provider === undefined || face.providerCompatibility?.[provider] !== false,
  );
  const toOption = ({ imageId, face }: (typeof groups)[number]): LaunchImageOption => {
    const reason = !face.isActive
      ? '已禁用'
      : face.validationStatus === 'invalid' || face.validationStatus === 'pending'
        ? '无效：不符合平台约定'
        : undefined;
    const warning =
      reason === undefined && runtime !== '' && !face.supportedRuntimes.includes(runtime)
        ? `没有预装 ${runtimeName}，启动会明显变慢`
        : undefined;
    return {
      value: imageId,
      reference: face.ref,
      label: `${face.ref}${reason === undefined ? (warning === undefined ? '' : `（${warning}）`) : `（${reason}）`}`,
      disabled: reason !== undefined,
      ...(reason === undefined ? {} : { reason }),
      ...(warning === undefined ? {} : { warning }),
    };
  };
  const builtin = groups.find(({ face }) => face.isProviderDefault === true);
  const defaultOption = builtin === undefined ? undefined : toOption(builtin);
  return {
    options: groups.filter(({ face }) => face.isProviderDefault !== true).map(toOption),
    defaultLabel:
      defaultOption?.reason === undefined
        ? '平台预制镜像（默认）'
        : `平台预制镜像（${defaultOption.reason}）`,
    ...(defaultOption?.reason === undefined
      ? {}
      : {
          defaultDisabledReason:
            defaultOption.reason === '已禁用'
              ? '平台预制镜像已禁用，新任务用不了它：改选一张镜像，或到「镜像管理」重新启用它。'
              : '平台预制镜像验证没通过，新任务用不了它：改选一张镜像，或到「镜像管理」处理好再回来。',
        }),
  };
}

export function taskImageLabel(image: TaskImageSnapshot | undefined): string | undefined {
  return image === undefined
    ? undefined
    : `${image.reference}${image.isBuiltin === true ? '（平台预制镜像）' : ''}`;
}

export function taskImageDiagnostic(image: TaskImageSnapshot | undefined): string | undefined {
  return image === undefined
    ? undefined
    : image.digest === undefined
      ? image.reference
      : `${image.reference.split('@')[0] ?? image.reference}@${image.digest}`;
}
