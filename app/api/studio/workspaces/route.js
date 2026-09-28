import { readJsonBody, studioRoute } from '@/lib/server/studio-api';

export const dynamic = 'force-dynamic';

export const GET = studioRoute(async ({ store }) => {
  await store.ensureDefaultWorkspace();
  const workspaces = await Promise.all((await store.listWorkspaces()).map((workspace) => store.workspaceSummary(workspace.id)));
  return Response.json({ workspaces });
});

export const POST = studioRoute(async ({ request, store }) => {
  const workspace = await store.createWorkspace(await readJsonBody(request));
  return Response.json({ workspace: await store.workspaceSummary(workspace.id) }, { status: 201 });
});
