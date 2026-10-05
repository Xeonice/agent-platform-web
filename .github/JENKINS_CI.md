# Local Jenkins CI and prebuilt releases

This repository uses the Mac mini Jenkins job `agent-platform-web`. The former
GitHub Actions build is preserved under `workflow-archive/ci.yml`; that directory
is outside GitHub's active workflow directory. The Jenkins definitions and
installed phase tools are maintained in `Xeonice/cloud-agent-platform-docs` under
`deploy/jenkins/web.groovy` and `deploy/jenkins/jenkins-web.mjs`.

The source configuration disables Vercel Git builds. Production publication uses
locally built Build Output API artifacts. Changing `vercel.json` takes effect
when the commit reaches GitHub; it does not change an existing deployment or
promote an existing staged deployment.

## CI coverage and trust boundary

The discovery job schedules `main` and open PR heads from this fixed repository.
The umbrella release job schedules `feat/design-v2-migration` with its pinned
project commits. Every run has full `SHA`, `REF`, `ROOT_SHA` and `API_SHA`
parameters. Jenkins checks out the exact requested commit, refuses a
ref that moved, installs with pnpm 9.15.0 and a frozen lockfile, and runs on native
macOS ARM64 Node 22.

Repository code runs on the separate `agent-platform-ci` agent and OS account.
It receives no production runtime environment, Vercel token or GitHub release
credential. The Jenkins controller has zero executors. For the production branch,
a trusted stage pulls the fixed Vercel project's settings without checking out
source. Only the approved public API/WS origins, disabled API mock flag and
Corepack setting are transferred to CI; other environment values are discarded.

CI runs type checking, lint, formatting, Story coverage, mock contract anchoring,
the emoji gate, OpenAPI drift, all acceptance tests, all Storybook interaction
tests, a static Storybook build and the production build. Tests produce JSON and
JUnit results; missing, failed or skipped tests block packaging. Storybook's
interaction runner is not an accessibility certification.

Production builds run `vercel build --prod --standalone` locally with an empty
authentication directory. Internal function aliases are flattened; references
outside the output and macOS native binaries are rejected before upload. The
committed `.env.example` documentation sample is excluded from traced function
output. Actual env/auth files remain forbidden in the package.

## Artifacts and publication

Jenkins archives a literal whitelist under `web-artifacts/`: execution reports,
JUnit XML, `manifest.json`, `source.tar.gz`, `prebuilt.tar.gz` and
`storybook.tar.gz`. The manifest records all three commits, the originating
Jenkins job/build, actual gate results and archive/tree hashes. The source archive
comes from `git archive` of the pinned commit. Private env files, Vercel global
configuration, raw authentication output and local caches are not archived.

The umbrella release job separately verifies Jenkins' final `SUCCESS` and the
exact commit parameters, then downloads and verifies those artifacts. The trusted
deployment agent adopts an immutable release keyed by all three commits. Reused
packages retain their original bytes and originating build evidence.

Upload uses `vercel deploy --prebuilt --prod --skip-domain --archive=tgz` for the
fixed `agent-platform-web` project. This uploads compiled output without a remote
build and leaves it staged. Before promotion the tool rechecks the approved
project pin, current production branch, API commit/readiness and remote deployment
metadata. Completed retries verify the actual production alias. Failed or
unfinished publication intents require operator review; they are not silently
reset or replaced.

The web CI job has no deployment trigger. Publication belongs to the umbrella
release job, which coordinates API activation, frontend promotion and the full
project GitHub Release. Preview deployments remain disabled until a separate
same-site frontend/API environment is configured and approved.

## Local verification

Normal development commands remain available:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:stories
pnpm check:mock-contracts
pnpm check:no-emoji
pnpm check:api-drift
pnpm test
pnpm test:storybook
pnpm build-storybook
pnpm build
```

The managed Jenkins dashboard is local to the Mac mini. Its build history,
stage graph, console and archived reports are the execution evidence; a prepared
pipeline definition or manual local smoke is not a successful Jenkins run.
