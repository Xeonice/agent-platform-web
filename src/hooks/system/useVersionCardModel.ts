import { deriveUpgradeModel } from '@/lib/system/upgradeModel';
import { loadedWebBuild } from '@/services/system/loadedWebBuild';
import { useInstanceUpgradeContext } from '@/hooks/system/useInstanceUpgrade';
export function useVersionCardModel() {
  const controller = useInstanceUpgradeContext();
  return { controller, model: controller?.model ?? deriveUpgradeModel(null, loadedWebBuild, 0) };
}
