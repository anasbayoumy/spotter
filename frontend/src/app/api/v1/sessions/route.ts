import { apiContracts, listSessionsQuerySchema } from "@spotter/contracts";

import { apiRoute, getBackend, listPage, parseQuery } from "../_shared";

export function GET(request: Request): Promise<Response> {
  return apiRoute(request, apiContracts.sessions.list.output, async (context) => {
    const input = parseQuery(request, listSessionsQuerySchema);
    return listPage(await (await getBackend()).sessions.list(input, context), input);
  });
}
