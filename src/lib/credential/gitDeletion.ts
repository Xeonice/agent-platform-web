import type { MaskedGitCredential, GitCredentialDeletionModel } from '@/types/gitCredential';
import type { ProjectDto } from '@/types/project';
import { GIT_PLATFORMS, isKnownGitPlatform } from '@/lib/credential/gitPlatforms';

function matchingProjects(
  credential: Pick<MaskedGitCredential, 'type' | 'allowedHosts'>,
  projects: ProjectDto[],
): ProjectDto[] {
  return projects.filter((project) => {
    const address = project.repoUrl;
    if (project.sourceType !== 'git' || address === undefined) return false;
    const ssh = address.startsWith('ssh://') || /^[^/\s]+@[^:/\s]+:/.test(address);
    if (credential.type === 'ssh-key') return ssh;
    if (ssh) return false;
    try {
      const host = new URL(address).host.toLowerCase();
      return credential.allowedHosts.some((allowed) => allowed.trim().toLowerCase() === host);
    } catch {
      return false;
    }
  });
}

export function gitCredentialProjects(
  credential: MaskedGitCredential,
  projects: ProjectDto[],
): string[] {
  return matchingProjects(credential, projects).map((project) => project.name);
}

export function gitCredentialTestRepo(
  credential: Pick<MaskedGitCredential, 'type' | 'allowedHosts'>,
  projects: ProjectDto[],
): string | undefined {
  return matchingProjects(credential, projects)[0]?.repoUrl;
}

export function gitDeletionModel(
  credential: MaskedGitCredential,
  lastUsedLabel: string | undefined,
  projects: ProjectDto[] | undefined,
): GitCredentialDeletionModel {
  const ssh = credential.type === 'ssh-key';
  const hosts = credential.allowedHosts.join('、');
  const provider =
    credential.platform !== undefined && isKnownGitPlatform(credential.platform)
      ? GIT_PLATFORMS[credential.platform].label
      : 'Git 服务';
  return {
    title: `删除 Git 凭证「${ssh ? 'SSH 私钥' : `HTTPS Token · ${hosts}`}」？`,
    subtitle: lastUsedLabel === undefined ? 'Git 凭证' : `Git 凭证 · 最后使用 ${lastUsedLabel}`,
    subject: `${ssh ? '这把 SSH 私钥' : '这份 HTTPS Token'}（${credential.maskedIdentifier}）`,
    hosts,
    provider,
    ssh,
    projectNames: projects === undefined ? [] : gitCredentialProjects(credential, projects),
    projectsKnown: projects !== undefined,
  };
}
