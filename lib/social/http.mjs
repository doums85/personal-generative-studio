import { SocialError } from './errors.mjs';

/**
 * Calls a platform API and converts failures into SocialError.
 * `describe` maps the parsed response body to `{ message, code }` when the platform reported an error.
 */
export async function requestJson(fetchImpl, url, { method = 'GET', headers = {}, body, form, json, describe } = {}) {
  const init = { method, headers: { ...headers } };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(Object.entries(form).filter(([, value]) => value !== undefined && value !== null).map(([name, value]) => [name, String(value)])).toString();
  } else if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json; charset=UTF-8';
    init.body = JSON.stringify(json);
  } else if (body !== undefined) {
    init.body = body;
  }
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new SocialError(`Réseau injoignable : ${error instanceof Error ? error.message : error}`, 502, 'network_error');
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non JSON body */ }
  const failure = describe?.(data, response);
  if (failure || !response.ok) {
    const message = failure?.message || data?.error?.message || data?.error_description || `Erreur ${response.status} de la plateforme`;
    throw new SocialError(message, failure?.status || (response.status === 401 ? 401 : 502), failure?.code || 'platform_error', data);
  }
  return data;
}
