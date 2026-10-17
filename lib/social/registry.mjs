import { metaConnector, facebookPublisher, instagramPublisher } from './meta.mjs';
import { tiktokConnector, tiktokPublisher } from './tiktok.mjs';
import { SocialError } from './errors.mjs';

export const CONNECTORS = { meta: metaConnector, tiktok: tiktokConnector };
export const PUBLISHERS = { facebook: facebookPublisher, instagram: instagramPublisher, tiktok: tiktokPublisher };

export function getConnector(id) {
  const connector = CONNECTORS[id];
  if (!connector) throw new SocialError('Réseau inconnu', 404, 'unknown_connector');
  return connector;
}

export function getPublisher(platform) {
  const publisher = PUBLISHERS[platform];
  if (!publisher) throw new SocialError('Plateforme inconnue', 404, 'unknown_platform');
  return publisher;
}

export function missingEnv(connector, env = process.env) {
  return connector.requiredEnv.filter((name) => !env[name]);
}

/** Which networks can be connected right now, and what is still missing to do so. */
export function connectorStatus(env = process.env) {
  return Object.values(CONNECTORS).map((connector) => {
    const missing = missingEnv(connector, env);
    return { id: connector.id, label: connector.label, platforms: connector.platforms, configured: missing.length === 0, missingEnv: missing };
  });
}

export function connectorFor(platform) {
  const connector = Object.values(CONNECTORS).find((item) => item.platforms.includes(platform));
  if (!connector) throw new SocialError('Plateforme inconnue', 404, 'unknown_platform');
  return connector;
}
