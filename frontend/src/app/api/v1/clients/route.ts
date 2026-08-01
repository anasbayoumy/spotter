import { apiContracts, listClientsQuerySchema } from "@spotter/contracts";

import { apiRoute, getBackend, listPage, parseQuery } from "../_shared";

export function GET(request: Request): Promise<Response> {
  return apiRoute(request, apiContracts.clients.list.output, async (context) => {
    const input = parseQuery(request, listClientsQuerySchema);
    return listPage(await (await getBackend()).clients.list(input, context), input);
  });
}
