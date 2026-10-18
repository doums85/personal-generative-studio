/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as lib_owner from "../lib/owner.js";
import type * as lib_socialDb from "../lib/socialDb.js";
import type * as lib_views from "../lib/views.js";
import type * as library from "../library.js";
import type * as libraryInternal from "../libraryInternal.js";
import type * as publishing from "../publishing.js";
import type * as social from "../social.js";
import type * as socialInternal from "../socialInternal.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "lib/owner": typeof lib_owner;
  "lib/socialDb": typeof lib_socialDb;
  "lib/views": typeof lib_views;
  library: typeof library;
  libraryInternal: typeof libraryInternal;
  publishing: typeof publishing;
  social: typeof social;
  socialInternal: typeof socialInternal;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
