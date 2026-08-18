// Git 凭证编排逻辑（F21-3 §4/§5）：列表 + save/test/revoke + clone 401 回程重试。副作用/lib/service-error
// 归 hook（07 §6，boundaries 禁 container→lib/service）。凭证明文只在本 hook 的局部 state，提交/关闭即清空
// ——绝不进 store/persist（15 §3.5 安全红线）。GitCredentialsContainer 只消费本 hook 的返回并装配视图。
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useGitCredentials } from '@/hooks/useGitCredentials';
import {
  useSaveGitCredential,
  useTestGitCredential,
  useRevokeGitCredential,
} from '@/hooks/useGitCredentialMutations';
import { useRetryClone } from '@/hooks/useProjects';
import { useAppStore } from '@/stores';
import {
  platformToHost,
  sshKeyHasPassphrase,
  looksLikePrivateKey,
  isAllowedHostsValid,
  gitTestErrorMessage,
  GIT_CREDENTIAL_GUIDANCE,
  HTTPS_TOKEN_SCOPE_HINT,
} from '@/lib/gitCredential';
import { GIT_PLATFORM_OPTIONS, type GitPlatformOption } from '@/lib/gitPlatforms';
import { ApiErrorException } from '@/services/api/apiError';
import type {
  GitCredentialCardModel,
  GitCredentialTestOutcome,
  GitCredentialType,
  GitPlatform,
  GitTestRequest,
  MaskedGitCredential,
} from '@/types/gitCredential';

/** 前端测试连接 15s 兜底（P21-3 §10.3）：超时即中止 loading，避免按钮永远转圈。 */
const TEST_TIMEOUT_MS = 15_000;

export interface GitCredentialManager {
  loading: boolean;
  cards: GitCredentialCardModel[];
  missingTypes: GitCredentialType[];
  guidanceText: string;
  scopeHint: string;
  busy: boolean;
  pendingRetry: { name: string; retrying: boolean } | null;
  retryClone: () => void;
  discardPending: () => void;

  activeForm: 'ssh' | 'https' | null;
  openSshForm: () => void;
  openHttpsForm: () => void;
  closeForm: () => void;

  // —— SSH 表单 ——
  sshKey: string;
  setSshKey: (value: string) => void;
  sshWarning: string | null;
  sshSubmitDisabled: boolean;
  submitSsh: () => void;

  // —— HTTPS 表单 ——
  /** 选来源选项（从 lib `GIT_PLATFORMS` 注册表派生，透传给视图，view 不硬编码平台列表）。 */
  platformOptions: GitPlatformOption[];
  platform: GitPlatform;
  setPlatform: (platform: GitPlatform) => void;
  token: string;
  setToken: (value: string) => void;
  allowedHosts: string[];
  setAllowedHosts: (hosts: string[]) => void;
  httpsSubmitDisabled: boolean;
  submitHttps: () => void;

  // —— 表单内测试连接 ——
  formTesting: boolean;
  formTestResult: GitCredentialTestOutcome | null;
  testForm: () => void;

  // —— 卡片动作 ——
  replace: (credential: MaskedGitCredential) => void;
  testCard: (credential: MaskedGitCredential) => void;
  revoke: (credential: MaskedGitCredential) => void;

  saving: boolean;
}

interface ActiveForm {
  kind: 'ssh' | 'https';
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof ApiErrorException && error.envelope.message !== ''
    ? error.envelope.message
    : fallback;
}

function errorCodeOf(error: unknown): string | undefined {
  return error instanceof ApiErrorException ? error.envelope.code : undefined;
}

/** 最后使用时间的粗粒度相对展示（非精确，仅识别用）；lastUsedAt 生成物为 string | null。 */
function formatLastUsed(iso: string | null | undefined): string | undefined {
  if (iso === undefined || iso === null || iso === '') return undefined;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return undefined;
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${String(diffMin)} 分钟前`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)} 小时前`;
  return `${String(Math.round(diffHr / 24))} 天前`;
}

export function useGitCredentialManager(): GitCredentialManager {
  const router = useRouter();
  const credentials = useGitCredentials();
  const saveMutation = useSaveGitCredential();
  const testMutation = useTestGitCredential();
  const revokeMutation = useRevokeGitCredential();
  const retryCloneMutation = useRetryClone();

  const pendingProjectCreate = useAppStore((s) => s.pendingProjectCreate);
  const setPendingProjectCreate = useAppStore((s) => s.setPendingProjectCreate);

  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);
  const [sshKey, setSshKey] = useState('');
  const [token, setToken] = useState('');
  const [platform, setPlatform] = useState<GitPlatform>('github');
  const [allowedHosts, setAllowedHosts] = useState<string[]>(['github.com']);

  const [formTestResult, setFormTestResult] = useState<GitCredentialTestOutcome | null>(null);
  const [formTesting, setFormTesting] = useState(false);
  const [cardTestingId, setCardTestingId] = useState<string | null>(null);
  const [cardTest, setCardTest] = useState<{
    id: string;
    outcome: GitCredentialTestOutcome;
  } | null>(null);

  const list = useMemo(() => credentials.data ?? [], [credentials.data]);
  const missingTypes = useMemo<GitCredentialType[]>(() => {
    const configured = new Set(list.map((c) => c.type));
    return (['ssh-key', 'https-token'] as const).filter((t) => !configured.has(t));
  }, [list]);

  const cards = useMemo<GitCredentialCardModel[]>(
    () =>
      list.map((credential) => ({
        credential,
        lastUsedLabel: formatLastUsed(credential.lastUsedAt),
        testing: cardTestingId === credential.id,
        testResult: cardTest?.id === credential.id ? cardTest.outcome : null,
      })),
    [list, cardTestingId, cardTest],
  );

  const closeForm = (): void => {
    setActiveForm(null);
    setSshKey('');
    setToken('');
    setFormTestResult(null);
    setFormTesting(false);
  };

  const openSshForm = (): void => {
    // 私钥永不回显，无论新增还是"更换"都从空表单起（save 侧 SSH 的 allowedHosts 恒为 []，无 host 上下文可留）。
    setActiveForm({ kind: 'ssh' });
    setSshKey('');
    setFormTestResult(null);
  };
  // 打开 HTTPS 表单；source 非空 = "更换"既有 token → 预填其 platform/allowedHosts（token 明文不回显，需重填），
  // 避免默认跳回 GitHub 态而静默覆盖内网多 host 白名单（F21-3 §10.2 修）。
  const fillHttpsForm = (source: MaskedGitCredential | null): void => {
    setActiveForm({ kind: 'https' });
    setToken('');
    setPlatform(source?.platform ?? 'github');
    setAllowedHosts(source ? [...source.allowedHosts] : ['github.com']);
    setFormTestResult(null);
  };
  const openHttpsForm = (): void => {
    fillHttpsForm(null);
  };

  const handlePlatformChange = (next: GitPlatform): void => {
    setPlatform(next);
    const host = platformToHost(next);
    // SaaS → 自动推导 host；其他（自建）→ 清空交用户手填（可再加多个）。
    setAllowedHosts(host === null ? [] : [host]);
  };

  // 回程仓库 URL（clone 401 携带）：作为 ls-remote 目标；InlineGitTestDto.repoUrl 需 minLength 1，空则不带。
  const repoTarget = ((): string | undefined => {
    const url = pendingProjectCreate?.url;
    return url !== undefined && url !== '' ? url : undefined;
  })();

  const runTest = async (body: GitTestRequest): Promise<GitCredentialTestOutcome> => {
    try {
      const result = await Promise.race([
        testMutation.mutateAsync(body),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            reject(new Error('TIMEOUT_LOCAL'));
          }, TEST_TIMEOUT_MS),
        ),
      ]);
      return result.ok
        ? { ok: true, message: '' }
        : { ok: false, message: gitTestErrorMessage(result.errorCode) };
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'TIMEOUT_LOCAL'
          ? 'TIMEOUT_LOCAL'
          : errorCodeOf(error);
      return { ok: false, message: gitTestErrorMessage(code) };
    }
  };

  // 表单内 [测试连接]：存前测 → inline（带当前粘贴的 secret + 表单配置）。
  const testForm = (): void => {
    if (activeForm === null) return;
    const body: GitTestRequest =
      activeForm.kind === 'ssh'
        ? {
            source: 'inline',
            type: 'ssh-key',
            secret: sshKey,
            allowedHosts: [],
            ...(repoTarget !== undefined ? { repoUrl: repoTarget } : {}),
          }
        : {
            source: 'inline',
            type: 'https-token',
            secret: token,
            platform,
            allowedHosts: allowedHosts.map((h) => h.trim().toLowerCase()),
            ...(repoTarget !== undefined ? { repoUrl: repoTarget } : {}),
          };
    setFormTesting(true);
    setFormTestResult(null);
    void runTest(body).then((outcome) => {
      setFormTestResult(outcome);
      setFormTesting(false);
    });
  };

  // 卡片 [测试连接]：已入库 → stored（带 credentialId，按当前分区选，P21-3 §10.3）。
  const testCard = (credential: MaskedGitCredential): void => {
    const body: GitTestRequest = {
      source: 'stored',
      credentialId: credential.id,
      ...(repoTarget !== undefined ? { repoUrl: repoTarget } : {}),
    };
    setCardTestingId(credential.id);
    setCardTest(null);
    void runTest(body).then((outcome) => {
      setCardTest({ id: credential.id, outcome });
      setCardTestingId(null);
    });
  };

  const submitSsh = (): void => {
    if (sshKey.trim() === '' || sshKeyHasPassphrase(sshKey) || !looksLikePrivateKey(sshKey)) return;
    saveMutation.mutate(
      { type: 'ssh-key', secret: sshKey, allowedHosts: [] },
      {
        onSuccess: () => {
          toast.success('SSH 密钥已保存');
          closeForm();
        },
        onError: (error) => {
          toast.error(errorMessageOf(error, '保存失败，请稍后重试。'));
        },
      },
    );
  };

  const submitHttps = (): void => {
    if (token.trim() === '' || !isAllowedHostsValid(allowedHosts)) return;
    saveMutation.mutate(
      {
        type: 'https-token',
        secret: token,
        platform,
        allowedHosts: allowedHosts.map((h) => h.trim().toLowerCase()),
      },
      {
        onSuccess: () => {
          toast.success('HTTPS Token 已保存');
          closeForm();
        },
        onError: (error) => {
          toast.error(errorMessageOf(error, '保存失败，请稍后重试。'));
        },
      },
    );
  };

  const revoke = (credential: MaskedGitCredential): void => {
    revokeMutation.mutate(credential.id, {
      onSuccess: () => {
        toast.success('凭证已吊销');
      },
      onError: (error) => {
        toast.error(errorMessageOf(error, '吊销失败，请稍后重试。'));
      },
    });
  };

  const replace = (credential: MaskedGitCredential): void => {
    if (credential.type === 'ssh-key') openSshForm();
    else fillHttpsForm(credential); // 预填被替换 token 的 platform/allowedHosts，只轮换 token 时不丢白名单
  };

  const retryClone = (): void => {
    if (pendingProjectCreate === null) return;
    retryCloneMutation.mutate(pendingProjectCreate.projectId, {
      onSuccess: () => {
        setPendingProjectCreate(null);
        router.push('/');
      },
      onError: (error) => {
        toast.error(errorMessageOf(error, '重试克隆失败，请稍后重试。'));
      },
    });
  };

  const discardPending = (): void => {
    setPendingProjectCreate(null);
  };

  const sshWarning = ((): string | null => {
    if (activeForm?.kind !== 'ssh' || sshKey.trim() === '') return null;
    if (sshKeyHasPassphrase(sshKey)) {
      return '检测到带 passphrase 的私钥，当前不支持，请改用无口令的密钥。';
    }
    if (!looksLikePrivateKey(sshKey)) {
      return '这看起来不是有效的私钥（应以 -----BEGIN … PRIVATE KEY----- 开头）。';
    }
    return null;
  })();

  return {
    loading: credentials.isPending,
    cards,
    missingTypes,
    guidanceText: GIT_CREDENTIAL_GUIDANCE,
    scopeHint: HTTPS_TOKEN_SCOPE_HINT,
    busy: revokeMutation.isPending,
    pendingRetry:
      pendingProjectCreate !== null
        ? { name: pendingProjectCreate.name, retrying: retryCloneMutation.isPending }
        : null,
    retryClone,
    discardPending,

    activeForm: activeForm === null ? null : activeForm.kind,
    openSshForm,
    openHttpsForm,
    closeForm,

    sshKey,
    setSshKey,
    sshWarning,
    sshSubmitDisabled:
      sshKey.trim() === '' || sshKeyHasPassphrase(sshKey) || !looksLikePrivateKey(sshKey),
    submitSsh,

    platformOptions: GIT_PLATFORM_OPTIONS,
    platform,
    setPlatform: handlePlatformChange,
    token,
    setToken,
    allowedHosts,
    setAllowedHosts,
    httpsSubmitDisabled: token.trim() === '' || !isAllowedHostsValid(allowedHosts),
    submitHttps,

    formTesting,
    formTestResult,
    testForm,

    replace,
    testCard,
    revoke,

    saving: saveMutation.isPending,
  };
}
