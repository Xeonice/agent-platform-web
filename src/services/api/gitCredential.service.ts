// Git 凭证 REST（F21-3 §4/§8）：走全站唯一 typed apiClient（与 project/sandbox.service 一致），
// 路径/参数/响应均受生成 openapi.d.ts 约束（改后端契约 → generate:api → 此处编译期报红）。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type {
  MaskedGitCredential,
  CreateGitCredentialRequest,
  StoreGitCredentialResponse,
  GitTestResult,
  GitTestRequest,
} from '@/types/gitCredential';

/** MVP 只有一种 kind，写死为字面量（F21-3 §8 前端纪律）——不作为方法参数暴露，杜绝调用方传出 400。 */
const GIT_KIND = 'git';

/** GET /api/credentials?kind=git → 掩码列表（私钥/token 明文永不回读）。 */
export async function listGitCredentials(): Promise<MaskedGitCredential[]> {
  const { data, error, response } = await apiClient.GET('/api/credentials', {
    params: { query: { kind: GIT_KIND } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** POST /api/credentials/git → 201 {id, maskedIdentifier}（不回明文；body 因形态而异）。 */
export async function saveGitCredential(
  input: CreateGitCredentialRequest,
): Promise<StoreGitCredentialResponse> {
  const { data, error, response } = await apiClient.POST('/api/credentials/git', {
    body: input,
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * POST /api/credentials/git/test → 后端 git ls-remote（15s）；只回 ok/errorCode（不回 ref 名）。
 * body 为判别联合（discriminator: source）：存前测 inline（带 secret）/ 卡片测 stored（带 credentialId）。
 */
export async function testGitCredential(body: GitTestRequest): Promise<GitTestResult> {
  const { data, error, response } = await apiClient.POST('/api/credentials/git/test', {
    body,
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** DELETE /api/credentials/git/:id → 吊销（无联动清除——Git 凭证不注入 sandbox，P21-3 §10.3）。 */
export async function revokeGitCredential(id: string): Promise<void> {
  const { error, response } = await apiClient.DELETE('/api/credentials/git/{id}', {
    params: { path: { id } },
  });
  if (!response.ok) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
}
