// 新建沙箱入口（S1）：provider 档位单选 + [新建沙箱并打开终端]。纯展示、props 驱动、零副作用。
import type { SandboxProvider } from '@/types/sandbox';
import { Button } from '@/components/ui/button';

export interface NewSandboxPanelProps {
  providers: readonly SandboxProvider[];
  provider: SandboxProvider;
  onSelectProvider: (provider: SandboxProvider) => void;
  onCreate: () => void;
  creating: boolean;
  errorMessage?: string;
}

const PROVIDER_HINT: Record<SandboxProvider, string> = {
  aio: '全能镜像（默认）',
  boxlite: '轻量档',
};

export function NewSandboxPanelView({
  providers,
  provider,
  onSelectProvider,
  onCreate,
  creating,
  errorMessage,
}: NewSandboxPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold">新建沙箱并打开终端</h2>
        <p className="mt-1 text-sm text-muted-foreground">创建一个沙箱并连接其终端</p>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={creating}>
        <legend className="mb-1 text-xs text-muted-foreground">运行档位 (provider)</legend>
        {providers.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="sandbox-provider"
              value={p}
              checked={provider === p}
              onChange={() => {
                onSelectProvider(p);
              }}
            />
            <span className="font-mono">{p}</span>
            <span className="text-muted-foreground">— {PROVIDER_HINT[p]}</span>
          </label>
        ))}
      </fieldset>

      {errorMessage !== undefined && errorMessage !== '' && (
        <p role="alert" className="max-w-sm text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      <Button
        onClick={() => {
          onCreate();
        }}
        disabled={creating}
      >
        {creating ? '创建中…' : '新建沙箱并打开终端'}
      </Button>
    </div>
  );
}
