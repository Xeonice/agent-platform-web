import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
/** Local builds identify actual input bytes; release builds inject their verified manifest revision. */
export function webBuildIdentity() {
  const hash = createHash('sha1');
  const visit = (relative) => {
    const path = join(root, relative);
    if (!existsSync(path)) return;
    const children = readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      const name = `${relative}/${child.name}`;
      if (child.isDirectory()) visit(name);
      else if (child.isFile()) {
        hash.update(name);
        hash.update(readFileSync(join(root, name)));
      }
    }
  };
  for (const directory of ['src', 'public', 'patches', 'scripts']) visit(directory);
  for (const name of [
    'package.json',
    'pnpm-lock.yaml',
    'next.config.mjs',
    'tsconfig.json',
    'tailwind.config.ts',
    'postcss.config.mjs',
  ]) {
    if (existsSync(join(root, name))) {
      hash.update(name);
      hash.update(readFileSync(join(root, name)));
    }
  }
  const publicKeys = Object.keys(process.env)
    .filter((key) => key.startsWith('NEXT_PUBLIC_') && key !== 'NEXT_PUBLIC_WEB_REVISION')
    .sort();
  for (const key of [...publicKeys, 'API_ORIGIN']) {
    hash.update(`${key}\0`);
    hash.update(`${process.env[key] ?? ''}\0`);
  }
  const revision = process.env.NEXT_PUBLIC_WEB_REVISION;
  if (revision !== undefined && !/^[a-f0-9]{40}$/.test(revision))
    throw new Error('NEXT_PUBLIC_WEB_REVISION must match the immutable Web manifest revision');
  const release = process.env.NEXT_PUBLIC_WEB_RELEASE_ID ?? '';
  if (release !== '' && !/^v?\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(release))
    throw new Error('Invalid Web release identity');
  const builtAt = process.env.NEXT_PUBLIC_WEB_BUILT_AT ?? '';
  if (builtAt !== '' && !Number.isFinite(Date.parse(builtAt)))
    throw new Error('Invalid Web build timestamp');
  return {
    NEXT_PUBLIC_WEB_REVISION: revision ?? hash.digest('hex'),
    NEXT_PUBLIC_WEB_RELEASE_ID: release,
    NEXT_PUBLIC_WEB_BUILT_AT: builtAt,
  };
}
