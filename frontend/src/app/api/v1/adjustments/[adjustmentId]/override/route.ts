import {
  adjustmentPathParamsSchema,
  apiContracts,
  overrideAdjustmentRequestSchema,
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
    apiContracts.adjustments.override.output,
    async (context) => {
      const [{ adjustmentId }, input] = await Promise.all([
        parseParams(route.params, adjustmentPathParamsSchema),
        parseBody(request, overrideAdjustmentRequestSchema),
      ]);
      return (await getBackend()).adjustments.override(adjustmentId, input, context);
    },
    { mutation: true },
  );
}
