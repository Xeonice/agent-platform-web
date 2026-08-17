// 凭证管理页 /settings/credentials（F21-3 §2）：只装配 container（app 层只做布局编排，07 §2）。
// S3 切片仅落地 Git 凭证分区；Runtime 凭证分区留待后续切片。口令门包裹与工作台一致。
import { AccessGateContainer } from '@/containers/AccessGateContainer';
import { GitCredentialsContainer } from '@/containers/GitCredentialsContainer';

export default function CredentialsPage() {
  return (
    <AccessGateContainer>
      <GitCredentialsContainer />
    </AccessGateContainer>
  );
}
