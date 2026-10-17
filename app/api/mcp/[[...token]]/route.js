import { loadGatewayCatalog } from '@/lib/gateway/engine.mjs';
import { createBlobPublisher, fetchBlobUrl, handleMcpRequest } from '@/lib/server/mcp-http.mjs';
import { getStudioStore } from '@/lib/studio/store.mjs';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Hosted MCP endpoint (Streamable HTTP, stateless) for Claude Cloud connectors.
 * Authenticated with MCP_AUTH_TOKEN, either as a Bearer header or as `/api/mcp/<token>`.
 * Generated media is uploaded to Vercel Blob and returned as download URLs.
 */
async function handle(request, context) {
  const { token = [] } = (await context.params) || {};
  if (token.length > 1) return Response.json({ error: 'Not found' }, { status: 404 });

  return handleMcpRequest(request, {
    authToken: process.env.MCP_AUTH_TOKEN,
    pathToken: token[0],
    // An explicit token wins over the OIDC credentials of any other Blob store connected to the project.
    remote: { publish: createBlobPublisher({ token: process.env.BLOB_READ_WRITE_TOKEN }), fetchOwn: fetchBlobUrl },
    store: getStudioStore(),
    loadCatalog: () => loadGatewayCatalog({ fetchOptions: { next: { revalidate: 900 } } }),
  });
}

export { handle as GET, handle as POST, handle as DELETE };
