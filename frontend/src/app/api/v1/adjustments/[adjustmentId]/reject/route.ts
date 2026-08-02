import {
  adjustmentPathParamsSchema,
  apiContracts,
  reviewAdjustmentRequestSchema,
} from "@spotter/contracts";

import {
  apiRoute,
  getBackend,
  parseBody,
  parseParams,
  type DynamicRouteContext,
} from "../../../_shared";

export function POST(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.adjustments.reject.output,
    async (context) => {
      const [{ adjustmentId }, input] = await Promise.all([
        parseParams(route.params, adjustmentPathParamsSchema),
        parseBody(request, reviewAdjustmentRequestSchema),
      ]);
      return (await getBackend()).adjustments.reject(adjustmentId, input, context);
    },
    { mutation: true },
  );
}
