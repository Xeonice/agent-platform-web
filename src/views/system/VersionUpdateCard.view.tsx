import { useState, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  VersionUpdateDetailsView,
  type VersionUpdateDetailsProps,
} from '@/views/system/VersionUpdateDetails.view';

interface Props extends VersionUpdateDetailsProps {
  headingRef: Ref<HTMLHeadingElement>;
  authorizationOpen: boolean;
  onAuthorizationOpenChange: (open: boolean) => void;
  authorizationBusy: boolean;
  authorizationError: string | null;
  onAuthorize: (key: string) => void;
}
function UpgradeAuthorizationInput({
  onAuthorize,
  busy,
}: {
  onAuthorize: (key: string) => void;
  busy: boolean;
}) {
  // Secret input is local only. This component unmounts immediately on success/close.
  const [key, setKey] = useState('');
  return (
    <form
      data-upgrade-authorization
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) {
          onAuthorize(key);
          setKey('');
        }
      }}
      className="space-y-3"
    >
      <Input
        type="password"
        name="upgrade-key"
        aria-label="实例升级授权密钥"
        autoComplete="off"
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
        }}
      />
      <Button type="submit" disabled={busy || key.length < 16}>
        {busy ? '正在验证…' : '授权升级'}
      </Button>
    </form>
  );
}
export function VersionUpdateCardView({
  headingRef,
  authorizationOpen,
  onAuthorizationOpenChange,
  authorizationBusy,
  authorizationError,
  onAuthorize,
  ...details
}: Props) {
  return (
    <section
      id="version"
      aria-labelledby="system-version-heading"
      className="rounded-lg border border-border p-4"
    >
      <h2
        id="system-version-heading"
        ref={headingRef}
        tabIndex={-1}
        className="mb-3 text-base font-semibold"
      >
        版本与更新
      </h2>
      <VersionUpdateDetailsView {...details} />
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">运行产物详情</summary>
        <dl className="mt-2 space-y-1">
          {details.model.artifactDetails.map((fact) => (
            <div key={fact.label}>
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="break-all font-mono">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </details>
      {details.model.canAuthenticate && !details.model.canUpgrade ? (
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => {
            onAuthorizationOpenChange(true);
          }}
        >
          授权升级
        </Button>
      ) : null}
      <Dialog open={authorizationOpen} onOpenChange={onAuthorizationOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>授权本实例升级</DialogTitle>
            <DialogDescription>
              使用安装时授予的独立升级密钥。普通访问口令不授予升级权限，取消不影响查看版本。
            </DialogDescription>
          </DialogHeader>
          {authorizationOpen ? (
            <UpgradeAuthorizationInput onAuthorize={onAuthorize} busy={authorizationBusy} />
          ) : null}
          {authorizationError === null ? null : (
            <p role="alert" className="text-sm text-error">
              {authorizationError}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
