/** Read-only process observation. These public identifiers confer no authority. */
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    {
      instanceId: process.env['PLATFORM_INSTANCE_ID'] ?? null,
      pid: process.pid,
      startIdentity: process.env['PLATFORM_PROCESS_START_IDENTITY'] ?? null,
      artifactDigest: process.env['PLATFORM_ARTIFACT_DIGEST'] ?? null,
      webRevision: process.env['NEXT_PUBLIC_WEB_REVISION'] ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
