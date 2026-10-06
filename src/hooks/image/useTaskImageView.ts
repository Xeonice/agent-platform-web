import { taskImageDiagnostic, taskImageLabel } from '@/lib/image/launchImageOptions';
import type { TaskImageSnapshot } from '@/types/image';
import type { SandboxDto } from '@/types/sandbox';

export function sandboxTaskImage(sandbox: SandboxDto): TaskImageSnapshot | undefined {
  return sandbox.image === undefined
    ? undefined
    : {
        reference: sandbox.image,
        ...(sandbox.imageId === undefined ? {} : { id: sandbox.imageId }),
        ...(sandbox.imageDigest === undefined ? {} : { digest: sandbox.imageDigest }),
        ...(sandbox.imageIsBuiltin === undefined ? {} : { isBuiltin: sandbox.imageIsBuiltin }),
      };
}

export function useTaskImageView(image: TaskImageSnapshot | undefined) {
  return { label: taskImageLabel(image), diagnostic: taskImageDiagnostic(image) };
}
