import { SocialError } from './errors.mjs';
import { requestJson } from './http.mjs';
import { TIKTOK_LIMITS } from './platforms.mjs';

const API = 'https://open.tiktokapis.com';
const SCOPES = 'user.info.basic,video.publish,video.upload';

const KNOWN_ERRORS = {
  access_token_invalid: ['token_expired', 401, 'La session TikTok a expiré : reconnectez le compte.'],
  scope_not_authorized: ['scope_missing', 403, 'Autorisation TikTok manquante : reconnectez le compte en acceptant toutes les permissions.'],
  url_ownership_unverified: ['url_unverified', 400, 'TikTok n’a pas pu vérifier votre domaine : ajoutez le préfixe d’URL « /api/studio/public/ » dans les « URL properties » de votre application TikTok.'],
  unaudited_client_can_only_post_to_private_accounts: ['unaudited_app', 403, 'Application TikTok non auditée : publiez en « Moi uniquement » ou envoyez en brouillon tant que l’audit n’est pas validé.'],
  rate_limit_exceeded: ['rate_limited', 429, 'Limite de requêtes TikTok atteinte : réessayez dans quelques minutes.'],
  spam_risk_too_many_posts: ['rate_limited', 429, 'TikTok limite le nombre de publications par jour pour ce compte.'],
};

function describe(data) {
  if (data?.error && typeof data.error === 'string') {
    return { message: data.error_description || data.error, code: data.error === 'invalid_grant' ? 'token_expired' : 'platform_error', status: data.error === 'invalid_grant' ? 401 : 502 };
  }
  const error = data?.error;
  if (!error || error.code === 'ok') return null;
  const [code, status, message] = KNOWN_ERRORS[error.code] || ['platform_error', 502, error.message || `Erreur TikTok (${error.code})`];
  return { message, code, status };
}

function toCredentials(token, now) {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(now + (token.expires_in || 86400) * 1000).toISOString(),
    refreshExpiresAt: token.refresh_expires_in ? new Date(now + token.refresh_expires_in * 1000).toISOString() : null,
  };
}

const authorized = (credentials) => ({ Authorization: `Bearer ${credentials.accessToken}` });

export const tiktokConnector = {
  id: 'tiktok',
  label: 'TikTok',
  platforms: ['tiktok'],
  requiredEnv: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],

  authorizeUrl({ env, redirectUri, state }) {
    const params = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, scope: env.TIKTOK_SCOPES || SCOPES, response_type: 'code', redirect_uri: redirectUri, state });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  },

  async connect({ env, code, redirectUri, fetch: fetchImpl = fetch, now = Date.now() }) {
    const token = await requestJson(fetchImpl, `${API}/v2/oauth/token/`, {
      method: 'POST',
      form: { client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirectUri },
      describe,
    });
    if (!token?.access_token) throw new SocialError('TikTok n’a renvoyé aucun jeton d’accès.', 502, 'platform_error', token);
    const credentials = toCredentials(token, now);
    let profile = null;
    try {
      profile = (await requestJson(fetchImpl, `${API}/v2/user/info/?fields=open_id,avatar_url,display_name`, { headers: authorized(credentials), describe }))?.data?.user;
    } catch { /* the profile is cosmetic: the account is still usable */ }
    return [{ platform: 'tiktok', externalId: token.open_id || profile?.open_id, name: profile?.display_name || 'Compte TikTok', handle: null, avatarUrl: profile?.avatar_url || null, credentials }];
  },

  /** Exchanges the refresh token for a fresh access token (TikTok access tokens last 24 h). */
  async refresh({ env, fetch: fetchImpl = fetch, credentials, now = Date.now() }) {
    const token = await requestJson(fetchImpl, `${API}/v2/oauth/token/`, {
      method: 'POST',
      form: { client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: credentials.refreshToken },
      describe,
    });
    if (!token?.access_token) throw new SocialError('TikTok n’a pas renouvelé la session : reconnectez le compte.', 401, 'token_expired');
    return toCredentials({ refresh_token: credentials.refreshToken, ...token }, now);
  },
};

export const tiktokPublisher = {
  id: 'tiktok',
  label: 'TikTok',

  /** Privacy levels and limits the creator is currently allowed to use (TikTok requires showing only these). */
  async options({ fetch: fetchImpl = fetch, credentials }) {
    const info = (await requestJson(fetchImpl, `${API}/v2/post/publish/creator_info/query/`, { method: 'POST', headers: authorized(credentials), json: {}, describe }))?.data || {};
    return {
      nickname: info.creator_nickname || null,
      privacyLevels: info.privacy_level_options || ['SELF_ONLY'],
      maxVideoSeconds: info.max_video_post_duration_sec || null,
      commentDisabled: Boolean(info.comment_disabled),
      duetDisabled: Boolean(info.duet_disabled),
      stitchDisabled: Boolean(info.stitch_disabled),
    };
  },

  async start({ fetch: fetchImpl = fetch, credentials, media, caption, options = {} }) {
    const draft = options.mode === 'draft';
    const privacy = options.privacyLevel || 'SELF_ONLY';
    const interactions = { disable_comment: Boolean(options.disableComment), disable_duet: Boolean(options.disableDuet), disable_stitch: Boolean(options.disableStitch) };
    let path;
    let json;
    if (media.kind === 'video') {
      path = draft ? '/v2/post/publish/inbox/video/init/' : '/v2/post/publish/video/init/';
      json = { source_info: { source: 'PULL_FROM_URL', video_url: media.url } };
      if (!draft) json.post_info = { title: caption.slice(0, TIKTOK_LIMITS.video), privacy_level: privacy, ...interactions };
    } else {
      path = '/v2/post/publish/content/init/';
      json = {
        media_type: 'PHOTO',
        post_mode: draft ? 'MEDIA_UPLOAD' : 'DIRECT_POST',
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: [media.url] },
        post_info: { title: caption.slice(0, TIKTOK_LIMITS.photoTitle), description: caption.slice(0, TIKTOK_LIMITS.photoDescription), privacy_level: privacy, disable_comment: interactions.disable_comment, auto_add_music: true },
      };
    }
    const result = await requestJson(fetchImpl, `${API}${path}`, { method: 'POST', headers: authorized(credentials), json, describe });
    const publishId = result?.data?.publish_id;
    if (!publishId) throw new SocialError('TikTok n’a pas renvoyé d’identifiant de publication.', 502, 'platform_error', result);
    return { status: 'processing', state: { publishId, draft } };
  },

  async advance({ fetch: fetchImpl = fetch, credentials, state }) {
    const result = await requestJson(fetchImpl, `${API}/v2/post/publish/status/fetch/`, { method: 'POST', headers: authorized(credentials), json: { publish_id: state.publishId }, describe });
    const data = result?.data || {};
    if (data.status === 'FAILED') throw new SocialError(`TikTok a refusé la publication${data.fail_reason ? ` : ${data.fail_reason}` : ''}.`, 422, 'media_rejected', data);
    if (data.status === 'PUBLISH_COMPLETE') return { status: 'published', remoteId: data.publicaly_available_post_id?.[0] ? String(data.publicaly_available_post_id[0]) : state.publishId, url: null };
    if (data.status === 'SEND_TO_USER_INBOX') return { status: 'published', remoteId: state.publishId, url: null, draft: true };
    return { status: 'processing', state };
  },
};
