import type { LoadedWebBuild } from '@/types/upgrade';

/** Next replaces these literals at build time. API updates cannot overwrite this identity. */
const revision = process.env['NEXT_PUBLIC_WEB_REVISION'];
const release = process.env['NEXT_PUBLIC_WEB_RELEASE_ID'];
const builtAt = process.env['NEXT_PUBLIC_WEB_BUILT_AT'];
export const loadedWebBuild: Readonly<LoadedWebBuild> = Object.freeze({
  webRevision: revision !== undefined && /^[a-f0-9]{40}$/.test(revision) ? revision : null,
  releaseId: release !== undefined && release !== '' ? release : null,
  builtAt: builtAt !== undefined && builtAt !== '' ? builtAt : null,
});
