import { api } from '../convex/api.mjs';
import { publicPublication, publishGeneration, refreshPublication } from './service.mjs';

/**
 * Where publishing actually runs. On Convex the whole job lives there: the web app and the MCP server only ask for
 * a publication and read its state, while Convex sends it (at the scheduled time if needed) and follows the network
 * until the post is live. Without Convex the studio does it itself, in this process.
 */

export async function publish({ social, workspaceId, input, env, fetch, now, sleep, settle }) {
  if (social.backend === 'convex') return social.service.action(api.publishing.publish, { workspaceUid: workspaceId, input });
  return publishGeneration({ social, workspaceId, input, env, fetch, now, sleep, settle });
}

/** Current state of a publication; in-process mode also checks with the network first (Convex already follows it by itself). */
export async function follow({ social, workspaceId, publicationId, env, fetch, now }) {
  if (social.backend === 'convex') return publicPublication(await social.getPublication(workspaceId, publicationId));
  return refreshPublication({ social, workspaceId, publicationId, env, fetch, now });
}
