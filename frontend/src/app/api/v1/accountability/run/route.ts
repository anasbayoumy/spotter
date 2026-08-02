import { apiContracts, runAccountabilityRequestSchema } from "@spotter/contracts";

import { apiRoute, getBackend, parseBody } from "../../_shared";

export function POST(request: Request): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.accountability.run.output,
    async (context) => {
      const input = await parseBody(request, runAccountabilityRequestSchema);
      return (await getBackend()).accountability.run(input, context);
    },
    { mutation: true },
  );
}
