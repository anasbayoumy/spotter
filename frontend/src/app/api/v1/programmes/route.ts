import { apiContracts, listProgrammesQuerySchema } from "@spotter/contracts";

import { apiRoute, getBackend, listPage, parseQuery } from "../_shared";

export function GET(request: Request): Promise<Response> {
  return apiRoute(request, apiContracts.programmes.list.output, async (context) => {
    const input = parseQuery(request, listProgrammesQuerySchema);
    return listPage(await (await getBackend()).programmes.list(input, context), input);
  });
}
