// known_hosts 指纹核对（F21-3 §3，P21-3 §10.2）：首次连接自动记录的主机指纹，供用户核对。
// 纯展示、props 驱动。指纹是可公开信息（非密钥），明文展示。
import type { KnownHostEntry } from '@/types/gitCredential';

export interface KnownHostsRowProps {
  knownHosts: KnownHostEntry[];
}

export function KnownHostsRowView({ knownHosts }: KnownHostsRowProps) {
  if (knownHosts.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <span className="font-medium">已记录主机指纹（首次连接自动信任，可核对）：</span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {knownHosts.map((entry) => (
          <li key={`${entry.host}:${entry.fingerprint}`} className="break-all font-mono">
            {entry.host} ({entry.keyType}) {entry.fingerprint}
          </li>
        ))}
      </ul>
    </div>
  );
}
