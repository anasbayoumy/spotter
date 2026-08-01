import {
  apiContracts,
  lifecycleMutationRequestSchema,
  programmePathParamsSchema,
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
    apiContracts.programmes.approve.output,
    async (context) => {
      const [{ programmeId }, input] = await Promise.all([
        parseParams(route.params, programmePathParamsSchema),
        parseBody(request, lifecycleMutationRequestSchema),
      ]);
      return (await getBackend()).programmes.approve(programmeId, input, context);
    },
    { mutation: true },
  );
}
