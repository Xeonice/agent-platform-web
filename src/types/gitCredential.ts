// Git 凭证领域类型：REST 形状一律来自后端生成物（generate:api → openapi.d.ts），杜绝手写漂移。
// 明文（私钥/token）永不出现在任何响应 DTO（掩码契约，P21-3 §10.3）。
import type { components } from '@/types/generated/openapi';

/** 掩码列表项（GET /api/credentials?kind=git）：maskedIdentifier = SSH 指纹 / Token 尾号；私钥/token 明文永不回读。 */
export type MaskedGitCredential = components['schemas']['MaskedGitCredentialResponseDto'];
/** 保存请求体（POST /api/credentials/git）：body 因形态而异（ssh-key 传私钥 / https-token 传 token+platform+allowedHosts）。 */
export type CreateGitCredentialRequest = components['schemas']['CreateGitCredentialDto'];
/** 保存响应（仅回 id + maskedIdentifier，不回明文）。 */
export type StoreGitCredentialResponse = components['schemas']['StoreGitCredentialResponseDto'];
/** 测试连接结果：ok + errorCode（'CLONE_FAILED_PERMISSION'|'CLONE_FAILED_NETWORK'|'TIMEOUT'）；不回任何 ref 名。 */
export type GitTestResult = components['schemas']['GitTestResultResponseDto'];

/** 测试连接请求体（判别联合，discriminator: source）：存前测 inline（带 secret）/ 卡片测 stored（带 credentialId）。 */
export type InlineGitTestRequest = components['schemas']['InlineGitTestDto'];
export type StoredGitTestRequest = components['schemas']['StoredGitTestDto'];
export type GitTestRequest = InlineGitTestRequest | StoredGitTestRequest;

/** SSH 私钥 / HTTPS Token 两种形态（生成物强制 enum，防漂移）。 */
export type GitCredentialType = MaskedGitCredential['type'];
/** Token 来源平台（选来源自动推导 host；'other' 手填自建 host）。 */
export type GitPlatform = NonNullable<MaskedGitCredential['platform']>;
/** 首次连接自动记录的主机指纹条目（凭证详情可核对，P21-3 §10.2）。 */
export type KnownHostEntry = NonNullable<MaskedGitCredential['knownHosts']>[number];

/** UI 层测试展示结果（errorCode 已映射为人话）。 */
export interface GitCredentialTestOutcome {
  ok: boolean;
  message: string;
}

/** 已配置凭证卡片的视图模型（容器/hook → 视图）。 */
export interface GitCredentialCardModel {
  credential: MaskedGitCredential;
  lastUsedLabel?: string;
  testing?: boolean;
  testResult?: GitCredentialTestOutcome | null;
}
