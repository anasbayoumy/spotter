import { apiContracts, listAdjustmentsQuerySchema } from "@spotter/contracts";

import { apiRoute, getBackend, listPage, parseQuery } from "../_shared";

export function GET(request: Request): Promise<Response> {
  return apiRoute(request, apiContracts.adjustments.list.output, async (context) => {
    const input = parseQuery(request, listAdjustmentsQuerySchema);
    return listPage(await (await getBackend()).adjustments.list(input, context), input);
  });
}
