export { getBackend } from "@spotter/backend/server";

export { assertCronSecret } from "../../../server/environment";
export { apiRoute, listPage, parseBody, parseParams, parseQuery } from "../../../server/http";

export interface DynamicRouteContext {
  readonly params: Promise<Record<string, string | string[] | undefined>>;
}
