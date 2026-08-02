import { apiContracts, sessionPathParamsSchema } from "@spotter/contracts";

import { apiRoute, getBackend, parseParams, type DynamicRouteContext } from "../../_shared";

export function GET(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(request, apiContracts.sessions.detail.output, async (context) => {
    const { sessionId } = await parseParams(route.params, sessionPathParamsSchema);
    return (await getBackend()).sessions.detail(sessionId, context);
  });
}
