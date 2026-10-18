import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Publishes the public keys and OpenID configuration Convex uses to verify the sign-in tokens.
auth.addHttpRoutes(http);

export default http;
