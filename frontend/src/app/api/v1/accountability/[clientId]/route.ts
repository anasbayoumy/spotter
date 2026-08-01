import { apiContracts, clientPathParamsSchema } from "@spotter/contracts";

import { apiRoute, getBackend, parseParams, type DynamicRouteContext } from "../../_shared";

export function GET(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(request, apiContracts.accountability.detail.output, async (context) => {
    const { clientId } = await parseParams(route.params, clientPathParamsSchema);
    return (await getBackend()).accountability.detail(clientId, context);
  });
}
