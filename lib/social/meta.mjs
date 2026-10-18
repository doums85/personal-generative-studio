import { SocialError } from './errors.mjs';
import { requestJson } from './http.mjs';

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'];

function version(env) {
  return env.META_GRAPH_VERSION || 'v23.0';
}

/** `META_GRAPH_BASE_URL` points the studio at another Graph API host (a local fake in tests); unset in real use. */
function graph(env, path) {
  return `${env.META_GRAPH_BASE_URL || 'https://graph.facebook.com'}/${version(env)}/${path}`;
}

function describe(data) {
  const error = data?.error;
  if (!error) return null;
  const expired = error.code === 190 || (error.type === 'OAuthException' && [458, 459, 460, 463, 467].includes(error.error_subcode));
  return {
    message: error.error_user_msg || error.message || 'Erreur Meta',
    code: expired ? 'token_expired' : 'platform_error',
    status: expired ? 401 : 502,
  };
}

/** Facebook Login: one authorisation yields every Page the user manages plus its linked Instagram professional account. */
export const metaConnector = {
  id: 'meta',
  label: 'Facebook & Instagram',
  platforms: ['facebook', 'instagram'],
  requiredEnv: ['META_APP_ID', 'META_APP_SECRET'],

  authorizeUrl({ env, redirectUri, state }) {
    const scopes = (env.META_SCOPES || SCOPES.join(',')).trim();
    const params = new URLSearchParams({ client_id: env.META_APP_ID, redirect_uri: redirectUri, state, scope: scopes, response_type: 'code' });
    return `https://www.facebook.com/${version(env)}/dialog/oauth?${params}`;
  },

  async connect({ env, code, redirectUri, fetch: fetchImpl = fetch }) {
    const exchange = (params) => requestJson(fetchImpl, `${graph(env, 'oauth/access_token')}?${new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, ...params })}`, { describe });
    const short = await exchange({ redirect_uri: redirectUri, code });
    const long = await exchange({ grant_type: 'fb_exchange_token', fb_exchange_token: short?.access_token });
    const userToken = long?.access_token;
    if (!userToken) throw new SocialError('Meta n’a renvoyé aucun jeton d’accès.', 502, 'platform_error');

    const fields = 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}';
    const accounts = [];
    let next = `${graph(env, 'me/accounts')}?${new URLSearchParams({ fields, limit: '100', access_token: userToken })}`;
    for (let page = 0; next && page < 10; page += 1) {
      const result = await requestJson(fetchImpl, next, { describe });
      for (const item of result?.data || []) {
        const credentials = { accessToken: item.access_token };
        accounts.push({ platform: 'facebook', externalId: item.id, name: item.name, handle: null, avatarUrl: item.picture?.data?.url || null, credentials });
        const instagram = item.instagram_business_account;
        if (instagram) {
          accounts.push({ platform: 'instagram', externalId: instagram.id, name: instagram.name || instagram.username, handle: instagram.username ? `@${instagram.username}` : null, avatarUrl: instagram.profile_picture_url || null, parentExternalId: item.id, credentials });
        }
      }
      next = result?.paging?.next || null;
    }
    if (!accounts.length) {
      throw new SocialError('Aucune Page Facebook accessible. Autorisez au moins une Page lors de la connexion (et liez-y votre compte Instagram professionnel).', 400, 'no_pages');
    }
    return accounts;
  },
};

export const facebookPublisher = {
  id: 'facebook',
  label: 'Facebook',

  async start({ env, fetch: fetchImpl = fetch, account, credentials, media, caption }) {
    const token = credentials.accessToken;
    const result = media.kind === 'video'
      ? await requestJson(fetchImpl, graph(env, `${account.externalId}/videos`), { method: 'POST', form: { file_url: media.url, description: caption, access_token: token }, describe })
      : await requestJson(fetchImpl, graph(env, `${account.externalId}/photos`), { method: 'POST', form: { url: media.url, caption, published: true, access_token: token }, describe });
    const remoteId = result?.post_id || result?.id;
    if (!remoteId) throw new SocialError('Facebook n’a pas confirmé la publication.', 502, 'platform_error', result);
    return { status: 'published', remoteId, url: media.kind === 'video' ? `https://www.facebook.com/watch/?v=${result.id}` : `https://www.facebook.com/${remoteId}` };
  },

  async advance() {
    return { status: 'published' };
  },
};

export const instagramPublisher = {
  id: 'instagram',
  label: 'Instagram',

  async start({ env, fetch: fetchImpl = fetch, account, credentials, media, caption, options = {} }) {
    const form = { caption, access_token: credentials.accessToken };
    if (media.kind === 'video') {
      form.media_type = 'REELS';
      form.video_url = media.url;
      form.share_to_feed = options.shareToFeed === false ? false : true;
    } else {
      form.image_url = media.url;
    }
    const container = await requestJson(fetchImpl, graph(env, `${account.externalId}/media`), { method: 'POST', form, describe });
    if (!container?.id) throw new SocialError('Instagram n’a pas créé le conteneur de média.', 502, 'platform_error', container);
    return { status: 'processing', state: { containerId: container.id } };
  },

  async advance({ env, fetch: fetchImpl = fetch, account, credentials, state }) {
    const token = credentials.accessToken;
    const container = await requestJson(fetchImpl, `${graph(env, state.containerId)}?${new URLSearchParams({ fields: 'status_code,status', access_token: token })}`, { describe });
    if (container?.status_code === 'ERROR' || container?.status_code === 'EXPIRED') {
      throw new SocialError(`Instagram a refusé le média${container.status ? ` : ${container.status}` : ''}.`, 422, 'media_rejected', container);
    }
    if (container?.status_code !== 'FINISHED') return { status: 'processing', state };
    const published = await requestJson(fetchImpl, graph(env, `${account.externalId}/media_publish`), { method: 'POST', form: { creation_id: state.containerId, access_token: token }, describe });
    let url = null;
    try {
      const details = await requestJson(fetchImpl, `${graph(env, published.id)}?${new URLSearchParams({ fields: 'permalink', access_token: token })}`, { describe });
      url = details?.permalink || null;
    } catch { /* the post is live even when the permalink lookup fails */ }
    return { status: 'published', remoteId: published.id, url };
  },
};
