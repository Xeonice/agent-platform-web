// 凭证管理页 /settings/credentials（F21-3 §2）：只装配 container（app 层只做布局编排，07 §2）。
// S4 切片：Runtime 凭证分区（帐号授权/API Key 二选一 + 重授权/吊销）与 Git 凭证分区并列，
// 由 CredentialsContainer 统一编排。口令门包裹与工作台一致。
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';
import { CredentialsContainer } from '@/containers/credential/CredentialsContainer';

export default function CredentialsPage() {
  return (
    <AccessGateContainer>
      <CredentialsContainer />
    </AccessGateContainer>
  );
}
