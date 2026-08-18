// host 白名单编辑（F21-3 §3，P21-3 §10.3）：增删多个 host（非敏感明示，host 不是密钥）。
// 受控：value/onChange 由容器持有；新增输入框为本地 UI 态（非敏感）。纯展示、零副作用。
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface AllowedHostsEditorProps {
  value: string[];
  onChange: (hosts: string[]) => void;
  disabled?: boolean;
}

export function AllowedHostsEditorView({
  value,
  onChange,
  disabled = false,
}: AllowedHostsEditorProps) {
  const [draft, setDraft] = useState('');

  const addHost = (): void => {
    const host = draft.trim().toLowerCase();
    if (host === '' || value.includes(host)) {
      setDraft('');
      return;
    }
    onChange([...value, host]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        host 白名单（明文，可加多个；一条 Token 只对白名单内的主机生效）
      </span>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((host) => (
            <li
              key={host}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-mono"
            >
              <span>{host}</span>
              <button
                type="button"
                aria-label={`移除 ${host}`}
                disabled={disabled}
                onClick={() => {
                  onChange(value.filter((h) => h !== host));
                }}
                className="text-muted-foreground hover:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          name="allowed-host"
          placeholder="git.internal.example.com"
          className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addHost();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addHost}>
          添加 host
        </Button>
      </div>
    </div>
  );
}
