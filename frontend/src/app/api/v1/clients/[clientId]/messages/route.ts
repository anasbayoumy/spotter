import { apiContracts, clientPathParamsSchema, listMessagesQuerySchema } from "@spotter/contracts";

import {
  apiRoute,
  getBackend,
  listPage,
  parseParams,
  parseQuery,
  type DynamicRouteContext,
} from "../../../_shared";

export function GET(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(request, apiContracts.clients.messages.output, async (context) => {
    const [{ clientId }, input] = await Promise.all([
      parseParams(route.params, clientPathParamsSchema),
      Promise.resolve(parseQuery(request, listMessagesQuerySchema)),
    ]);
    return listPage(await (await getBackend()).clients.messages(clientId, input, context), input);
  });
}
