import {
  adjustmentPathParamsSchema,
  apiContracts,
  editAdjustmentRequestSchema,
} from "@spotter/contracts";

import {
  apiRoute,
  getBackend,
  parseBody,
  parseParams,
  type DynamicRouteContext,
} from "../../_shared";

export function PATCH(request: Request, route: DynamicRouteContext): Promise<Response> {
  return apiRoute(
    request,
    apiContracts.adjustments.edit.output,
    async (context) => {
      const [{ adjustmentId }, input] = await Promise.all([
        parseParams(route.params, adjustmentPathParamsSchema),
        parseBody(request, editAdjustmentRequestSchema),
      ]);
      return (await getBackend()).adjustments.edit(adjustmentId, input, context);
    },
    { mutation: true },
  );
}
