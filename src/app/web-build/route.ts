/** Public, static identity of this exact deployed artifact; no runtime API or package fallback. */
export const dynamic = 'force-static';
export function GET() {
  const release = process.env['NEXT_PUBLIC_WEB_RELEASE_ID'];
  const builtAt = process.env['NEXT_PUBLIC_WEB_BUILT_AT'];
  return Response.json({
    webRevision: process.env['NEXT_PUBLIC_WEB_REVISION'] ?? null,
    releaseId: release === undefined || release === '' ? null : release,
    builtAt: builtAt === undefined || builtAt === '' ? null : builtAt,
  });
}
