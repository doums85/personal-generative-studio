import { SERVICE_AUDIENCE, SERVICE_ISSUER } from "./lib/owner";

/**
 * The studio's servers authenticate with short-lived RS256 tokens. The public half of the key lives in the
 * deployment's `STUDIO_SERVICE_JWKS` variable (set by `npm run convex:setup`); Convex refuses to deploy
 * these functions until it exists, so nothing is ever reachable without an owner key.
 */
const jwks = process.env.STUDIO_SERVICE_JWKS as string;

export default {
  providers: [
    // Tokens issued by Convex Auth when the owner signs in (see auth.ts).
    { domain: process.env.CONVEX_SITE_URL, applicationID: "convex" },
    {
      type: "customJwt" as const,
      applicationID: SERVICE_AUDIENCE,
      issuer: SERVICE_ISSUER,
      jwks: `data:text/plain;charset=utf-8;base64,${btoa(jwks)}`,
      algorithm: "RS256" as const,
    },
  ],
};
