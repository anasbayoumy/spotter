import { apiContracts, generateAdjustmentRequestSchema } from "@spotter/contracts";

import { apiRoute, getBackend, parseBody } from "../../_shared";

export function POST(request: Request): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.adjustments.generate.output,
    async (context) => {
      const input = await parseBody(request, generateAdjustmentRequestSchema);
      return (await getBackend()).adjustments.generate(input, context);
    },
    { mutation: true, successStatus: 201 },
  );
}
