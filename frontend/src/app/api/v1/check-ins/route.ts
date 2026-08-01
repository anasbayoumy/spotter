import { apiContracts, createCheckInRequestSchema } from "@spotter/contracts";

import { apiRoute, getBackend, parseBody } from "../_shared";

export function POST(request: Request): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.checkIns.create.output,
    async (context) => {
      const input = await parseBody(request, createCheckInRequestSchema);
      return (await getBackend()).checkIns.create(input, context);
    },
    { mutation: true, successStatus: 201 },
  );
}
