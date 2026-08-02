import { apiContracts, tracePathParamsSchema } from "@spotter/contracts";

import { apiRoute, getBackend, parseParams, type DynamicRouteContext } from "../../_shared";

export function GET(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(request, apiContracts.traces.detail.output, async (context) => {
    const { traceId } = await parseParams(route.params, tracePathParamsSchema);
    return (await getBackend()).traces.detail(traceId, context);
  });
}
